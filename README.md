# TributaSales

Sistema acadêmico de gestão de vendas. A atividade 3 parte da versão **v0.2.0** e organiza o backend em módulos MVC, mantendo as classes de domínio, as validações, a CLI, o ViaCEP e a experiência do catálogo.

## Executar

```bash
npm install
npm start                 # http://localhost:3000
npm run dev               # desenvolvimento com nodemon
```

Abrir `index.html` diretamente continua permitindo explorar o catálogo local, cupons, carrinho, calculadora e ViaCEP. Para CRUD e sincronização, use o endereço servido pelo Express.

## Arquitetura

```text
server/
├── routes/                 # mapeamento HTTP
├── controllers/            # entrada/saída das requisições
├── services/               # regras de aplicação e composição do domínio
├── repositories/           # persistência JSON com fs/promises
├── middleware/             # tratamento uniforme de erros
├── models.js               # Produto, ProdutoServico, ProdutoLicenca e Pedido
├── cep-service.js          # integração ViaCEP
├── server.js               # composição da aplicação
└── cli.js                  # interface de linha de comando preservada
data/                       # produtos.json e pedidos.json
```

## API REST

Todas as respostas de erro são JSON no formato `{ "erro": "...", "status": 400 }`. IDs precisam ser inteiros positivos; recursos inexistentes retornam `404`.

| Método | Endpoint | Sucesso |
| --- | --- | --- |
| GET | `/api/produtos` | `200` com a lista |
| GET | `/api/produtos/:id` | `200` com o produto |
| POST | `/api/produtos` | `201` com o produto criado |
| PUT/PATCH | `/api/produtos/:id` | `200` com o produto atualizado |
| DELETE | `/api/produtos/:id` | `204` |
| GET | `/api/produtos/media` | `200` com média e quantidade |
| GET | `/api/pedidos` | `200` com a lista |
| GET | `/api/pedidos/:id` | `200` com o pedido |
| POST | `/api/pedidos` | `201` com o pedido criado |
| PUT/PATCH | `/api/pedidos/:id` | `200` com o pedido atualizado |
| DELETE | `/api/pedidos/:id` | `204` |
| GET | `/api/cep/:cep` | `200` com o endereço ViaCEP |

Exemplo de produto:

```bash
curl -X POST http://localhost:3000/api/produtos \
  -H "Content-Type: application/json" \
  -d "{\"nome\":\"Caderno\",\"descricao\":\"Capa kraft\",\"preco\":24.9,\"categoria\":\"Papelaria\"}"
```

Exemplo de pedido (o produto precisa existir):

```bash
curl -X POST http://localhost:3000/api/pedidos \
  -H "Content-Type: application/json" \
  -d "{\"cliente\":\"Ana\",\"cep\":\"01001-000\",\"itens\":[{\"produtoId\":1,\"quantidade\":2}]}"
```

## Frontend

O frontend consulta a API como fonte principal quando servido pelo Express. Além do catálogo, busca, filtros, carrinho, cupons, calculadora e CEP, a seção **Gestão de registros** demonstra criar, editar, listar e excluir produtos e pedidos. Não há CORS nem regras fiscais.

## CLI

```bash
npm run cli -- listar
npm run cli -- media
npm run cli -- cadastrar
npm run cli -- pedido
```

## Evolução

- **v0.1.0:** catálogo estático, carrinho, cupons, calculadora e validação de CEP.
- **v0.2.0:** Express, persistência JSON assíncrona, classes de domínio, CLI e primeiras APIs.
- **Atividade 3:** MVC explícito (rotas, controllers, services, repositories e middleware), CRUD completo de produtos/pedidos, respostas HTTP coerentes, `nodemon` e painel frontend conectado à API.

Os arquivos JSON em `data/` são a persistência da aplicação; não são adicionadas regras fiscais ou alíquotas legais.
