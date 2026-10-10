# Raízes do Nordeste

[Abrir o restaurante](https://dmfariaas.github.io/raizes-do-nordeste/)

Demonstração acadêmica de um restaurante com cardápio nordestino, carrinho, cupom, fidelidade e pagamentos simulados.

## Usar a demonstração

Escolha a unidade, monte o pedido e selecione um resultado para o pagamento. O cupom `RAIZES10` concede 10% de desconto. Não há cobrança nem coleta de dados de cartão.

Pedidos, estoque e pontos ficam no navegador, em IndexedDB. Cada navegador mantém seus próprios dados. Para recomeçar, abra **Como os dados são usados** e selecione **Reiniciar demonstração**.

## Publicação

O GitHub Pages publica os arquivos da raiz da branch `main`. Atualizações enviadas para essa branch geram uma nova publicação. Os arquivos `index.html`, `app.js` e `demo-store.js` devem permanecer no mesmo diretório. O arquivo `.nojekyll` preserva a publicação estática.

O site requer um navegador atual com JavaScript e armazenamento local habilitados. As regras de pedidos são executadas no próprio navegador; esta demonstração não integra uma operadora de pagamentos nem um servidor de pedidos reais.
