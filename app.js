import { demoRequest, resetDemo } from './demo-store.js';
const STORAGE_KEY='raizes-online-session-v1';
const $=id=>document.getElementById(id), money=v=>(v/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const descriptions={baiao:'Arroz, feijão e queijo coalho. Nosso clássico com aquele gosto de comida de casa.',tapioca:'Macia, quentinha e recheada com queijo. Simples do jeito que a gente gosta.',suco:'Cajá batido com água e açúcar. Um azedinho bom pra acompanhar a refeição.'};
let catalog=[],counts={},key=crypto.randomUUID(),busy=false,loading=false,locked=false,terminal=false,pendingBody=null,lastOrder=null,pendingResolution=null,loadVersion=0,catalogReady=false;
function save(){
  try{
    sessionStorage.setItem(STORAGE_KEY,JSON.stringify({v:1,key,counts,unit:$('unit').value,channel:$('channel').value,coupon:$('coupon').value,loyalty:$('loyalty').checked,payment:$('payment').value,pendingBody,lastOrder,pendingResolution}));
  }catch{
    $('storage-note').hidden=false;
  }
}
function validOrder(order){
  return order&&typeof order.id==='string'&&/^[a-zA-Z0-9_-]{8,80}$/.test(order.id)&&['CONFIRMADO','RECUSADO','PENDENTE'].includes(order.status)&&Number.isInteger(order.total)&&order.total>=0&&Number.isInteger(order.points)&&order.points>=0;
}
function restore(){
  try{
    const state=JSON.parse(sessionStorage.getItem(STORAGE_KEY)||'null');
    if(!state||state.v!==1||!['REC','JPA'].includes(state.unit)||!['APP','WEB','TOTEM','BALCAO','PICKUP'].includes(state.channel)||!['approved','declined','timeout'].includes(state.payment)||typeof state.key!=='string'||!/^[a-zA-Z0-9_-]{8,80}$/.test(state.key))return;
    key=state.key;counts={};
    for(const sku of ['baiao','tapioca','suco'])if(Number.isInteger(state.counts?.[sku])&&state.counts[sku]>=0&&state.counts[sku]<=10)counts[sku]=state.counts[sku];
    $('unit').value=state.unit;$('channel').value=state.channel;$('coupon').value=typeof state.coupon==='string'?state.coupon:'';$('loyalty').checked=state.loyalty===true;$('payment').value=state.payment;
    if(typeof state.pendingBody==='string'){
      const request=JSON.parse(state.pendingBody);
      if(request.key===key&&request.unit===state.unit&&Array.isArray(request.items))pendingBody=state.pendingBody;
    }
    if(validOrder(state.lastOrder))lastOrder=state.lastOrder;
    pendingResolution=['approved','declined'].includes(state.pendingResolution)?state.pendingResolution:null;
    terminal=Boolean(lastOrder);locked=terminal||Boolean(pendingBody);
  }catch{
    try{sessionStorage.removeItem(STORAGE_KEY);}catch{}
  }
}
function summary(){
  const selected=catalog.filter(p=>counts[p.sku]);
  const subtotal=selected.reduce((s,p)=>s+p.price*counts[p.sku],0);
  const discount=$('coupon').value.trim().toUpperCase()==='RAIZES10'?Math.floor((subtotal*10+50)/100):0;
  $('subtotal').textContent=money(subtotal);$('discount').textContent=money(discount);$('total').textContent=money(subtotal-discount);
  $('items').replaceChildren();
  if(!selected.length)$('items').textContent='Seu carrinho está vazio.';
  for(const p of selected){const row=document.createElement('div');row.className='row';const a=document.createElement('span'),b=document.createElement('span');a.textContent=counts[p.sku]+' × '+p.name;b.textContent=money(counts[p.sku]*p.price);row.append(a,b);$('items').append(row);}
}
function renderMenu(){
  const menu=$('menu');menu.replaceChildren();
  const tags={baiao:'PRATO DA CASA',tapioca:'DA TAPIOCARIA',suco:'PRA REFRESCAR'};
  for(const p of catalog){
    const row=document.createElement('article');row.className='food';
    const art=document.createElement('div');art.className='food-art';art.setAttribute('aria-hidden','true');
    const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 120 120');
    const use=document.createElementNS('http://www.w3.org/2000/svg','use');use.setAttribute('href','#illustration-'+p.sku);svg.append(use);art.append(svg);
    const text=document.createElement('div');text.className='food-copy';
    const tag=document.createElement('span');tag.className='food-tag';tag.textContent=tags[p.sku];
    const h=document.createElement('h3');h.textContent=p.name;
    const desc=document.createElement('p');desc.textContent=descriptions[p.sku];
    const meta=document.createElement('div');meta.className='food-meta';
    const price=document.createElement('span');price.className='price';price.textContent=money(p.price);
    const stock=document.createElement('small');stock.textContent=p.stock===0?'Esgotado nesta unidade':p.stock+' disponíveis · até 10 por pedido';meta.append(price,stock);text.append(tag,h,desc,meta);
    const step=document.createElement('div');step.className='step';
    const minus=document.createElement('button'),plus=document.createElement('button'),out=document.createElement('output');
    minus.textContent='−';plus.textContent='+';minus.setAttribute('aria-label','Remover '+p.name);plus.setAttribute('aria-label','Adicionar '+p.name);
    minus.dataset.sku=p.sku;minus.dataset.action='minus';plus.dataset.sku=p.sku;plus.dataset.action='plus';
    out.setAttribute('aria-label','Quantidade de '+p.name);out.textContent=counts[p.sku]||0;
    const change=delta=>{if(locked||busy||loading||!catalogReady)return;counts[p.sku]=Math.min(Math.min(10,p.stock),Math.max(0,(counts[p.sku]||0)+delta));out.textContent=counts[p.sku];summary();save();controls();};
    minus.onclick=()=>change(-1);plus.onclick=()=>change(1);
    step.append(minus,out,plus);row.append(art,text,step);menu.append(row);
  }
}
function message(title,text,ok=false){const box=$('result');box.className='result'+(ok?' ok':'');box.replaceChildren();const h=document.createElement('h3'),p=document.createElement('p');h.textContent=title;p.textContent=text;box.append(h,p);box.focus();}
function warning(text){const p=document.createElement('p');p.textContent=text;$('result').append(p);}
function controls(){
  for(const input of document.querySelectorAll('#unit,#channel,#coupon,#loyalty,#payment'))input.disabled=locked||busy||loading;
  for(const button of document.querySelectorAll('.step button')){
    const p=catalog.find(p=>p.sku===button.dataset.sku),quantity=counts[p?.sku]||0;
    button.disabled=locked||busy||loading||!catalogReady||!p||(button.dataset.action==='plus'?quantity>=Math.min(10,p.stock):quantity===0);
  }
  $('submit').disabled=busy||loading||terminal||(!catalogReady&&!pendingBody);
  $('submit').textContent=busy?'Aguarde…':pendingBody?'Consultar o mesmo pedido':'Confirmar pedido simulado';
  $('new').hidden=!lastOrder||lastOrder.status==='PENDENTE';$('new').disabled=busy||loading;
  const pending=lastOrder?.status==='PENDENTE';$('payment-actions').hidden=!pending;
  $('resolve-approved').disabled=busy||loading||Boolean(pendingResolution&&pendingResolution!=='approved');
  $('resolve-declined').disabled=busy||loading||Boolean(pendingResolution&&pendingResolution!=='declined');
  $('refresh-catalog').disabled=busy||loading;$('refresh-session').disabled=busy;
}
const request = demoRequest;

function showOrder(order){
  lastOrder=order;terminal=true;locked=true;pendingBody=null;
  if(order.status==='CONFIRMADO')message('Pedido confirmado',money(order.total)+' · '+order.points+' pontos. Código '+order.id,true);
  else if(order.status==='RECUSADO')message('Pagamento recusado','Nenhuma cobrança foi realizada. Estoque e pontos preservados. Código '+order.id);
  else message('Pagamento pendente','O simulador não respondeu. Estoque e pontos permanecem intactos. Escolha abaixo o resultado da conferência simulada. Código '+order.id);
  controls();save();
}
async function load(){
  // Uma resposta antiga não deve substituir o cardápio da unidade escolhida depois.
  const version=++loadVersion,unit=$('unit').value;loading=true;catalogReady=false;controls();
  try{
    const{response,data}=await request('/api/catalog?unit='+encodeURIComponent(unit));
    if(!response.ok||!Array.isArray(data)||data.length!==3||new Set(data.map(p=>p.sku)).size!==3||data.some(p=>!['baiao','tapioca','suco'].includes(p.sku)||typeof p.name!=='string'||!Number.isInteger(p.price)||p.price<0||!Number.isInteger(p.stock)||p.stock<0))throw Error('Catálogo inválido');
    if(version!==loadVersion)return;
    catalog=data.sort((a,b)=>['baiao','tapioca','suco'].indexOf(a.sku)-['baiao','tapioca','suco'].indexOf(b.sku));catalogReady=true;
    let adjusted=false;
    if(!locked)for(const p of catalog){const before=counts[p.sku]||0;counts[p.sku]=Math.min(before,10,p.stock);adjusted||=before!==counts[p.sku];}
    renderMenu();summary();$('refresh-catalog').hidden=true;
    if(adjusted)message('Quantidade ajustada','O carrinho foi ajustado ao estoque disponível. Confira os itens antes de confirmar.');
    else if(!locked&&$('result').querySelector('h3')?.textContent==='Cardápio indisponível'){$('result').replaceChildren();$('result').className='';}
    save();
  }catch{
    if(version===loadVersion){
      $('refresh-catalog').hidden=false;
      if(locked)warning('Não foi possível atualizar o estoque exibido. O resultado deste pedido está registrado acima.');
      else{catalog=[];$('menu').replaceChildren();summary();message('Cardápio indisponível','Permita o armazenamento de dados deste site no navegador e use “Tentar carregar cardápio”. Seu pedido ainda não foi enviado.');}
    }
  }finally{if(version===loadVersion){loading=false;controls();}}
}
function sessionExpired(){message('Sessão atualizada no servidor','Use “Atualizar sessão” para continuar com o mesmo pedido. Os dados desta aba serão recuperados.');$('refresh-session').hidden=false;}
async function checkOrder(){
  if(!lastOrder)return;
  busy=true;controls();
  try{
    const{response,data}=await request('/api/orders/'+encodeURIComponent(lastOrder.id),{});
    if(response.status===401){sessionExpired();return;}
    if(response.status===404){lastOrder=null;terminal=false;locked=false;pendingResolution=null;key=crypto.randomUUID();message('Pedido não encontrado','Os dados desta demonstração foram limpos neste navegador. Confira o carrinho antes de começar uma nova simulação.');save();return;}
    if(!response.ok||!validOrder(data))throw Error();
    if(data.status!=='PENDENTE')pendingResolution=null;
    showOrder(data);
  }catch{warning('Não foi possível conferir o pedido salvo neste navegador. O resultado salvo nesta aba permanece visível. Permita o armazenamento de dados deste site e tente novamente.');}
  finally{busy=false;controls();}
}
$('unit').onchange=()=>{counts={};catalog=[];catalogReady=false;key=crypto.randomUUID();renderMenu();summary();save();load();};
$('coupon').oninput=()=>{summary();save();};
for(const id of ['channel','loyalty','payment'])$(id).onchange=save;
$('refresh-catalog').onclick=load;$('refresh-session').onclick=()=>{save();location.reload();};
$('new').onclick=()=>{
  if(busy||loading||lastOrder?.status==='PENDENTE')return;
  key=crypto.randomUUID();counts={};pendingBody=null;lastOrder=null;pendingResolution=null;locked=false;terminal=false;
  $('result').replaceChildren();$('result').className='';$('refresh-session').hidden=true;save();controls();load();
};
$('submit').onclick=async()=>{
  if(busy||loading||terminal||(!catalogReady&&!pendingBody))return;
  if(pendingBody===null){
    // Enquanto não houver resposta, as tentativas reutilizam este corpo e a mesma chave.
    const items=catalog.filter(p=>counts[p.sku]).map(p=>({sku:p.sku,qty:counts[p.sku]}));
    if(!items.length){message('Carrinho vazio','Adicione ao menos um produto.');return;}
    pendingBody=JSON.stringify({unit:$('unit').value,channel:$('channel').value,items,coupon:$('coupon').value.trim().toUpperCase(),loyalty:$('loyalty').checked,payment:$('payment').value,key});
  }
  busy=true;locked=true;save();controls();
  try{
    const{response,data}=await request('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:pendingBody});
    if(response.status===401){sessionExpired();return;}
    if(!response.ok){
      if(response.status>=500)throw Error();
      pendingBody=null;locked=false;save();message('Não foi possível concluir',data.message||'Confira os dados do pedido.');
      if(data.code==='SEM_ESTOQUE')await load();return;
    }
    if(!validOrder(data))throw Error();
    showOrder(data);await load();
  }catch{message('Não foi possível acessar a demonstração','Tente novamente para consultar o mesmo pedido, sem repetir a compra.');}
  finally{busy=false;controls();save();}
};
async function resolvePayment(payment){
  if(busy||loading||lastOrder?.status!=='PENDENTE'||(pendingResolution&&pendingResolution!==payment))return;
  // Se a resposta se perder, mantém a decisão para consultar o mesmo resultado.
  pendingResolution=payment;busy=true;controls();save();
  try{
    const{response,data}=await request('/api/orders/'+encodeURIComponent(lastOrder.id)+'/payment',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({payment})});
    if(response.status===401){sessionExpired();return;}
    if(!response.ok){
      if(response.status>=500)throw Error();
      pendingResolution=null;showOrder(lastOrder);warning(data.message||'Não foi possível conferir o pagamento.');
      if(data.code==='PAGAMENTO_JA_CONFERIDO')await checkOrder();
      if(data.code==='SEM_ESTOQUE')await load();return;
    }
    if(!validOrder(data))throw Error();
    pendingResolution=null;showOrder(data);await load();
  }catch{showOrder(lastOrder);warning('Não foi possível registrar a conferência. Repita a mesma opção para consultar o resultado, sem duplicar estoque ou pontos.');}
  finally{busy=false;controls();save();}
}
$('resolve-approved').onclick=()=>resolvePayment('approved');$('resolve-declined').onclick=()=>resolvePayment('declined');
$('reset-demo').onclick=async()=>{
  if(busy||loading||!confirm('Reiniciar a demonstração neste navegador? Os pedidos de teste serão apagados e o estoque voltará a 100 unidades por produto.'))return;
  busy=true;controls();$('reset-demo').disabled=true;
  try{
    await resetDemo();
    try{sessionStorage.removeItem(STORAGE_KEY);}catch{}
    key=crypto.randomUUID();counts={};pendingBody=null;lastOrder=null;pendingResolution=null;locked=false;terminal=false;
    $('coupon').value='';$('loyalty').checked=false;$('payment').value='approved';
    $('result').replaceChildren();$('result').className='';
    await load();save();
  }catch{message('Não foi possível reiniciar','Permita o armazenamento de dados deste site e tente novamente.');}
  finally{busy=false;controls();$('reset-demo').disabled=false;}
};
async function start(){
  restore();
  if(lastOrder)showOrder(lastOrder);
  else if(pendingBody)message('Pedido em conferência','A página foi recarregada durante o envio. Consulte o mesmo pedido pelo botão abaixo; a compra não será duplicada.');
  controls();await load();if(lastOrder)await checkOrder();
}
start();
