# TributaSales

Sistema de Gestão de Vendas – Parte 1, desenvolvido em HTML, CSS e JavaScript puro. A proposta combina a simplicidade esperada para um pequeno comerciante com uma interface inspirada em soluções brasileiras de gestão comercial e organização tributária.

## Problema e proposta

O pequeno comerciante muitas vezes controla produtos, descontos e entregas em anotações espalhadas. O TributaSales centraliza o catálogo, permite montar um pedido, aplica cupons e valida o endereço de entrega pelo CEP antes da finalização.

## Funcionalidades implementadas

- Catálogo com produtos/serviços em array de objetos, categorias, busca e filtro.
- Carrinho persistido no `localStorage`, alteração de quantidades e resumo de subtotal, desconto e total.
- Calculadora independente com validação de valor e percentual.
- Cupons demonstrativos: `PRIMEIRACOMPRA`, `CLIENTE10` e `PARCEIRO15`.
- Consulta à API pública [ViaCEP](https://viacep.com.br/) com normalização, estados de carregamento e mensagens de erro.
- Layout responsivo, acessível, sem dependências de backend ou pagamento real.
- Finalizar pedido é uma simulação: exibe uma confirmação, não processa pagamento e mantém o carrinho salvo. `Limpar pedido` remove os itens e persiste o carrinho vazio.

## Estrutura

```text
TributaSales/
├── index.html          # estrutura e conteúdo da interface
├── css/style.css       # identidade visual e responsividade
└── js/
    ├── produtos.js     # fonte de dados do catálogo
    ├── descontos.js    # regras de desconto e formatação monetária
    ├── cep.js          # integração e validação do ViaCEP
    └── app.js          # estado, eventos e renderização
```

## Como executar

1. Abra a pasta no VS Code.
2. Execute `index.html` com a extensão Live Server (recomendado) ou abra o arquivo diretamente no navegador.
3. Para testar o CEP, use, por exemplo, `01001-000`. A consulta depende de conexão com a internet.

## Script de implementação acadêmica

1. **Preparar:** criar a estrutura de pastas, definir o público-alvo e modelar `produtos` com `id`, nome, preço, categoria e descrição.
2. **Construir a tela:** criar HTML semântico para hero, catálogo, pedido e ferramentas; aplicar CSS responsivo e identidade visual.
3. **Renderizar dados:** implementar filtro por texto/categoria e gerar os cards com `map`, evitando valores fixos no HTML.
4. **Calcular vendas:** criar funções puras para moeda e desconto; validar entradas, limitar o percentual a 100% e exibir subtotal, economia e total.
5. **Gerenciar pedido:** implementar adicionar/remover/alterar quantidade, cupom, finalização simulada e persistência com `localStorage`.
6. **Integrar serviço externo:** normalizar o CEP, chamar o endpoint ViaCEP com `fetch`, tratar HTTP, CEP inexistente e indisponibilidade da rede.
7. **Validar:** testar catálogo vazio, filtros, valores inválidos, descontos de 0%/100%, CEP válido/inválido e atualização em telas pequenas.
8. **Apresentar:** gravar até 3 minutos mostrando o problema, adicionar um produto, aplicar `PRIMEIRACOMPRA`, consultar o CEP e explicar a separação dos arquivos.

## Evolução prática

Como próxima etapa, o projeto pode receber cadastro de clientes, estoque, autenticação, banco de dados, emissão fiscal e regras tributárias parametrizadas. As informações tributárias devem ser confirmadas com um profissional contábil antes de uso operacional.
