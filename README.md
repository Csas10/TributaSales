# TributaSales

Sistema acadêmico de gestão de vendas. A atividade 3 parte da versão **v0.3.0** e organiza o backend em módulos MVC, mantendo as classes de domínio, as validações, a CLI, o ViaCEP e a experiência do catálogo.

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
├── repositories/           # persistência local JSON e fallback efêmero em memória
├── middleware/             # tratamento uniforme de erros
├── models.js               # Produto, ProdutoServico, ProdutoLicenca e Pedido
├── cep-service.js          # integração ViaCEP
├── server.js               # composição da aplicação
└── cli.js                  # interface de linha de comando preservada
data/                       # produtos.json e pedidos.json
```

### Fluxo da aplicação

```text
frontend (index.html + js/) → routes → controllers → services → repositories
                                                        ├→ data/*.json (local)
                                                        └→ memória efêmera (Vercel)
```

No desenvolvimento local, `JsonRepository` lê e grava os arquivos JSON versionados em
`data/` usando `fs/promises`. Em Vercel, o mesmo repositório carrega os dados iniciais
dos JSON e usa uma cópia em memória para as alterações: o filesystem da função é
somente leitura e essa persistência é efêmera, podendo ser perdida entre instâncias ou
novos deploys. Os arquivos de dados não são ignorados pelo Git.

## Deploy na Vercel

O `vercel.json` encaminha `/`, `/css/**`, `/js/**` e `/api/**` para
`server/server.js`; o Express entrega os arquivos estáticos e as rotas MVC. Para
publicar, conecte o repositório à Vercel ou execute `vercel` na raiz do projeto.
A API funciona com o fallback em memória descrito acima, mas não deve ser usada como
armazenamento permanente em produção.

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
- **v0.3.0:** MVC explícito (rotas, controllers, services, repositories e middleware), CRUD completo de produtos/pedidos, respostas HTTP coerentes, `nodemon` e painel frontend conectado à API.
- **v0.3.1:** integração de deploy na Vercel, fallback efêmero em memória e proteção de respostas 500 em produção.

Os arquivos JSON em `data/` são a persistência local e a fonte inicial do deploy; não são adicionadas regras fiscais ou alíquotas legais.
