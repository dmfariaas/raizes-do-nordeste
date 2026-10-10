const DATABASE_NAME = 'raizes-nordeste-online-v1';
const STORE_NAME = 'demo';
const STATE_KEY = 'state';
const UNITS = ['REC', 'JPA'];
const CHANNELS = ['APP', 'WEB', 'TOTEM', 'BALCAO', 'PICKUP'];
const PRODUCTS = {
  baiao: { name: 'Baião de dois', price: 2500 },
  tapioca: { name: 'Tapioca de queijo', price: 1200 },
  suco: { name: 'Suco de cajá', price: 800 },
};

let databasePromise;

class RuleError extends Error {
  constructor(code, message, status = 422) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function initialState() {
  return {
    stock: Object.fromEntries(UNITS.map(unit => [
      unit, Object.fromEntries(Object.keys(PRODUCTS).map(sku => [sku, 100])),
    ])),
    orders: {},
    keys: {},
    points: 0,
  };
}

function openDatabase() {
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error('IndexedDB indisponível.'));
  }
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1);
      let blocked = false;
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        blocked = true;
        reject(new Error('Outra aba impediu a abertura do banco.'));
      };
      request.onsuccess = () => {
        const database = request.result;
        if (blocked) {
          database.close();
          return;
        }
        database.onversionchange = () => {
          database.close();
          databasePromise = undefined;
        };
        database.onclose = () => { databasePromise = undefined; };
        resolve(database);
      };
    }).catch(error => {
      databasePromise = undefined;
      throw error;
    });
  }
  return databasePromise;
}

function abortReason(signal) {
  return signal.reason || new DOMException('A operação foi cancelada.', 'AbortError');
}

async function withState(operation, write = false, signal) {
  if (signal?.aborted) throw abortReason(signal);
  const database = await openDatabase();
  if (signal?.aborted) throw abortReason(signal);
  return new Promise((resolve, reject) => {
    // A leitura e a gravação usam a mesma transação, inclusive entre abas.
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(STATE_KEY);
    let result;
    let failure;
    const cancel = () => {
      try { transaction.abort(); } catch { /* O resultado já pode estar confirmado. */ }
    };
    const cleanup = () => signal?.removeEventListener('abort', cancel);
    signal?.addEventListener('abort', cancel, { once: true });
    transaction.oncomplete = () => { cleanup(); resolve(result); };
    transaction.onabort = () => {
      cleanup();
      reject(failure || (signal?.aborted ? abortReason(signal) : transaction.error) || new Error('Transação interrompida.'));
    };
    request.onsuccess = () => {
      try {
        const state = request.result || initialState();
        result = operation(state);
        if (write || !request.result) store.put(state, STATE_KEY);
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };
  });
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalize(data) {
  if (!isObject(data)) throw new RuleError('DADOS_INVALIDOS', 'Envie um objeto de pedido.');
  const allowed = new Set(['unit', 'channel', 'items', 'coupon', 'loyalty', 'payment', 'key']);
  if (Object.keys(data).some(field => !allowed.has(field))) {
    throw new RuleError('CAMPO_NAO_PERMITIDO', 'O pedido contém campos não permitidos.');
  }
  const { unit, channel, items, key } = data;
  if (!UNITS.includes(unit)) throw new RuleError('UNIDADE_INVALIDA', 'Selecione uma unidade válida.');
  if (!CHANNELS.includes(channel)) throw new RuleError('CANAL_INVALIDO', 'Selecione um canal válido.');
  if (!Array.isArray(items) || items.length < 1 || items.length > 3) {
    throw new RuleError('CARRINHO_INVALIDO', 'Inclua entre um e três produtos diferentes.');
  }
  const seen = new Set();
  const normalizedItems = items.map(item => {
    if (!isObject(item) || Object.keys(item).length !== 2 || !Object.hasOwn(item, 'sku') || !Object.hasOwn(item, 'qty')) {
      throw new RuleError('ITEM_INVALIDO', 'Informe produto e quantidade.');
    }
    const { sku, qty } = item;
    if (typeof sku !== 'string' || !Object.hasOwn(PRODUCTS, sku) || seen.has(sku)) {
      throw new RuleError('PRODUTO_INVALIDO', 'Produto desconhecido ou repetido.');
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > 10) {
      throw new RuleError('QUANTIDADE_INVALIDA', 'A quantidade deve ser inteira, de 1 a 10.');
    }
    seen.add(sku);
    return { sku, qty };
  }).sort((left, right) => left.sku < right.sku ? -1 : left.sku > right.sku ? 1 : 0);
  const coupon = Object.hasOwn(data, 'coupon') ? data.coupon : '';
  if (!['', 'RAIZES10'].includes(coupon)) {
    throw new RuleError('CUPOM_INVALIDO', 'Cupom inválido. Use RAIZES10 na demonstração.');
  }
  const loyalty = Object.hasOwn(data, 'loyalty') ? data.loyalty : false;
  if (typeof loyalty !== 'boolean') {
    throw new RuleError('FIDELIDADE_INVALIDA', 'A opção de fidelidade deve ser verdadeira ou falsa.');
  }
  const payment = Object.hasOwn(data, 'payment') ? data.payment : 'approved';
  if (!['approved', 'declined', 'timeout'].includes(payment)) {
    throw new RuleError('PAGAMENTO_INVALIDO', 'Resultado simulado de pagamento inválido.');
  }
  if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,80}(?![\s\S])/.test(key)) {
    throw new RuleError('CHAVE_INVALIDA', 'A chave do pedido deve ter entre 8 e 80 caracteres seguros.');
  }
  return { unit, channel, items: normalizedItems, coupon, loyalty, payment, key };
}

function totals(order) {
  const subtotal = order.items.reduce((value, item) => value + PRODUCTS[item.sku].price * item.qty, 0);
  const discount = order.coupon ? Math.floor((subtotal * 10 + 50) / 100) : 0;
  const total = subtotal - discount;
  return { subtotal, discount, total, points: order.loyalty ? Math.floor(total / 100) : 0 };
}

function requireStock(state, order, message) {
  if (order.items.some(item => state.stock[order.unit][item.sku] < item.qty)) {
    throw new RuleError('SEM_ESTOQUE', message, 409);
  }
}

function applyConfirmation(state, order, points) {
  for (const item of order.items) state.stock[order.unit][item.sku] -= item.qty;
  state.points += points;
}

function createOrder(state, order) {
  const { key, ...content } = order;
  const digest = JSON.stringify(content);
  const requestKey = `${order.unit}:${key}`;
  const existing = state.orders[state.keys[requestKey]];
  if (existing) {
    if (existing.digest !== digest) {
      throw new RuleError('CHAVE_REUTILIZADA', 'Esta chave já foi usada para outro pedido.', 409);
    }
    return { status: 200, data: { ...existing.result, replayed: true } };
  }
  requireStock(state, order, 'Quantidade indisponível nesta unidade.');
  const values = totals(order);
  const status = { approved: 'CONFIRMADO', declined: 'RECUSADO', timeout: 'PENDENTE' }[order.payment];
  const result = {
    id: crypto.randomUUID(), unit: order.unit, channel: order.channel, status,
    subtotal: values.subtotal, discount: values.discount, total: values.total,
    points: status === 'CONFIRMADO' ? values.points : 0,
    items: order.items, coupon: order.coupon, loyalty: order.loyalty,
  };
  if (status === 'CONFIRMADO') applyConfirmation(state, order, values.points);
  state.orders[result.id] = { request: order, digest, result };
  state.keys[requestKey] = result.id;
  return { status: 201, data: { ...result, replayed: false } };
}

function findOrder(state, id) {
  const record = Object.hasOwn(state.orders, id) ? state.orders[id] : null;
  if (!record) throw new RuleError('NAO_ENCONTRADO', 'Pedido não encontrado.', 404);
  return record;
}

function resolvePayment(state, id, data) {
  if (!isObject(data) || Object.keys(data).length !== 1 || !['approved', 'declined'].includes(data.payment)) {
    throw new RuleError('PAGAMENTO_INVALIDO', 'Informe apenas payment com approved ou declined.');
  }
  const status = data.payment === 'approved' ? 'CONFIRMADO' : 'RECUSADO';
  const record = findOrder(state, id);
  const result = record.result;
  if (result.status !== 'PENDENTE') {
    if (result.status !== status) {
      throw new RuleError('PAGAMENTO_JA_CONFERIDO', 'Este pagamento já foi conferido. Consulte o resultado do pedido.', 409);
    }
    return { status: 200, data: { ...result, replayed: true } };
  }
  let points = 0;
  if (status === 'CONFIRMADO') {
    if (!record.request) {
      throw new RuleError('PEDIDO_ANTIGO', 'Este pedido foi criado em uma versão anterior. Recuse o pagamento pendente e inicie uma nova simulação.', 409);
    }
    // Um pedido pendente não reserva os itens; conferimos o estoque novamente.
    requireStock(state, record.request,
      'O estoque mudou e este pedido continua pendente. Recuse o pagamento e inicie uma nova simulação.');
    points = record.request.loyalty ? Math.floor(result.total / 100) : 0;
    applyConfirmation(state, record.request, points);
  }
  result.status = status;
  result.points = points;
  return { status: 200, data: { ...result, replayed: false } };
}

function readBody(body) {
  if (typeof body !== 'string') {
    if (body === undefined || body === null) {
      throw new RuleError('TAMANHO_INVALIDO', 'Corpo vazio ou maior que 16 KB.', 413);
    }
    throw new RuleError('JSON_INVALIDO', 'JSON inválido.', 400);
  }
  const length = new TextEncoder().encode(body).length;
  if (length === 0 || length > 16384) {
    throw new RuleError('TAMANHO_INVALIDO', 'Corpo vazio ou maior que 16 KB.', 413);
  }
  try {
    return JSON.parse(body);
  } catch {
    throw new RuleError('JSON_INVALIDO', 'JSON inválido.', 400);
  }
}

function response(status, data) {
  return { response: { ok: status >= 200 && status < 300, status }, data };
}

export async function demoRequest(url, options = {}) {
  try {
    if (options.signal?.aborted) throw abortReason(options.signal);
    const target = new URL(url, globalThis.location?.href || 'https://demo.local/');
    const method = (options.method || 'GET').toUpperCase();
    const path = target.pathname;
    if (method === 'GET' && path === '/api/health') {
      return response(200, { status: 'ok', environment: 'browser-demo' });
    }
    if (method === 'GET' && path === '/api/catalog') {
      const unit = target.searchParams.get('unit') || 'REC';
      if (!UNITS.includes(unit)) throw new RuleError('UNIDADE_INVALIDA', 'Selecione uma unidade válida.');
      const catalog = await withState(state => Object.keys(PRODUCTS).sort().map(sku => ({
        sku, name: PRODUCTS[sku].name, price: PRODUCTS[sku].price, stock: state.stock[unit][sku],
      })), false, options.signal);
      return response(200, catalog);
    }
    if (method === 'POST' && path === '/api/orders') {
      const order = normalize(readBody(options.body));
      const result = await withState(state => createOrder(state, order), true, options.signal);
      return response(result.status, result.data);
    }
    const orderPath = /^\/api\/orders\/([^/]+)(\/payment)?\/?$/.exec(path);
    if (orderPath && method === 'GET' && !orderPath[2]) {
      const result = await withState(state => findOrder(state, orderPath[1]).result, false, options.signal);
      return response(200, result);
    }
    if (orderPath && method === 'POST' && orderPath[2]) {
      const data = readBody(options.body);
      const result = await withState(state => resolvePayment(state, orderPath[1], data), true, options.signal);
      return response(result.status, result.data);
    }
    return response(404, { code: 'ROTA_INVALIDA', message: method === 'GET' ? 'Página não encontrada.' : 'Rota não encontrada.' });
  } catch (error) {
    if (options.signal?.aborted || error?.name === 'AbortError') throw error;
    if (error instanceof RuleError) return response(error.status, { code: error.code, message: error.message });
    return response(503, {
      code: 'SERVICO_INDISPONIVEL',
      message: 'Não foi possível acessar os dados da demonstração neste navegador. Permita o armazenamento local e tente novamente.',
    });
  }
}

export async function resetDemo() {
  await withState(state => Object.assign(state, initialState()), true);
}
