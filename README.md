# TributaSales

Sistema acadêmico de gestão de vendas. A Parte 2 evolui o baseline **v0.1.0** (Parte 1, HTML/CSS/JavaScript) para uma aplicação Node.js com Express, sem alterar a tag ou a release `v0.1.0`.

## Evolução da Parte 1 para a Parte 2

O front-end aprovado continua disponível e mantém catálogo, busca, filtros, carrinho, cupons, calculadora e validação de CEP. Agora, quando aberto pelo servidor, o catálogo é carregado por `GET /api/produtos`, a finalização registra em `POST /api/pedidos` e a consulta de endereço usa `GET /api/cep/:cep`. Abrir `index.html` diretamente continua funcionando com os dados locais e a consulta pública do ViaCEP.

## Implementações e ementa

| Implementação | Relação com a ementa |
| --- | --- |
| `server/models.js` com `Produto`, `ProdutoServico`, `ProdutoLicenca` e `Pedido` | Classes, encapsulamento, herança e polimorfismo (`tipo` e `calcularValorBase`) |
| `server/server.js` | Node.js, Express, rotas HTTP e integração com o cliente |
| `server/storage.js` e `data/*.json` | Persistência assíncrona com `fs/promises` |
| `server/cep-service.js` | Serviço externo assíncrono com `fetch` e `async/await` |
| `server/cli.js` | Interface de linha de comando para cadastrar/listar produtos, calcular média e registrar pedidos |
| `js/app.js` e `js/cep.js` | Consumo das APIs e preservação da experiência da Parte 1 |
| Validações nos modelos e nas rotas | Validação de nome, preço, quantidade e CEP |

A camada tributária permanece somente como fundação/simulação acadêmica. Não há alíquota legal fixa nem cálculo fiscal oficial; qualquer uso real deve ser definido com orientação contábil.

## Como executar

```bash
npm install
npm start
```

Acesse `http://localhost:3000`. A API mínima está disponível em:

- `GET/POST /api/produtos`
- `GET /api/produtos/media`
- `GET/POST /api/pedidos`
- `GET /api/cep/:cep`

## CLI

Com o servidor parado ou em outro terminal:

```bash
npm run cli -- listar
npm run cli -- media
npm run cli -- cadastrar
npm run cli -- pedido
```

Os dados são gravados em `data/produtos.json` e `data/pedidos.json`.

## Estrutura da Parte 2

```text
TributaSales/
├── index.html
├── css/style.css
├── js/                       # front-end da Parte 1 integrado à API
├── data/produtos.json        # persistência do catálogo
├── data/pedidos.json         # persistência dos pedidos
├── server/models.js          # domínio, herança e polimorfismo
├── server/storage.js         # fs/promises
├── server/cep-service.js     # serviço assíncrono de CEP
├── server/server.js          # Express
└── server/cli.js             # CLI
```
