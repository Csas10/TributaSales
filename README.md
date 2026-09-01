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
├── config/                 # ambientes e conexão Mongoose lazy
├── models/                 # schemas Mongoose introduzidos por gate
├── utils/                  # validações compartilhadas
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

## Gate 1 — Fundação MongoDB/Mongoose

O Gate 1 adiciona `dotenv`, `mongoose`, `server/config/env.js` e
`server/config/database.js` sem migrar os CRUDs. O MongoDB é opcional nesta
etapa: sem `MONGO_URI`, a aplicação continua usando os repositories JSON.
`MONGO_URI` deve ser fornecida por ambiente (`development`, `test`, `preview`
ou `production`) e nunca é versionada. O arquivo `.env.example` contém somente
nomes e valores demonstrativos.

`GET /api/health` informa apenas o ambiente funcional e o estado resumido do
Mongo (`not_configured`, `connecting`, `connected` ou `disconnected`), sem URI,
cluster ou credenciais. A conexão é lazy, reutiliza a conexão aquecida em
execuções serverless, deduplica chamadas simultâneas e permite nova tentativa
após uma falha.

## Gate 2 — User e Address

O Gate 2 adiciona os schemas Mongoose `User` e `Address` e seus services,
mantendo o CRUD JSON legado como fonte oficial. `Address.user` referencia
`User` por `ObjectId`; CEP é persistido com oito dígitos e UF com duas letras
maiúsculas. O usuário usa `passwordHash` não selecionável e removido da
serialização, enquanto a criação técnica força `role: "user"` e traduz email
duplicado para `409 Conflict`.

Ainda não existem controllers ou rotas públicas de User/Address. Não há
`password`, bcrypt, login, JWT, autorização ou schemas de marketplace neste
gate. Os services recebem a conexão e os models por injeção nos testes; nenhum
teste depende do Atlas ou do ViaCEP.

## Gate 3 — Autenticação

O Gate 3 adiciona `bcrypt`, `jsonwebtoken` e as rotas públicas
`POST /api/auth/register` e `POST /api/auth/login`. O registro recebe apenas
`name`, `email` e `password`; o hash é produzido internamente e nunca aparece
na resposta. O login retorna um JWT mínimo com `sub` igual ao identificador do
usuário, sem usar email ou role como autorização.

`JWT_SECRET` e `JWT_EXPIRES_IN` são opcionais no carregamento global. A
autenticação exige Mongo e configuração JWT somente durante a operação: sem
Mongo, as rotas de auth retornam `503`, enquanto `/api/health`,
`/api/produtos` e a persistência JSON continuam funcionando. Senhas têm entre
8 caracteres e 72 bytes UTF-8, sem `trim()`. Ainda não há middleware
`authenticate`, RBAC ou rotas de Address públicas.

## Gate 4 — Autenticação efetiva e ownership

O Gate 4 verifica o JWT com algoritmo fixo `HS256`, carrega o usuário atual do
Mongo e atribui somente sua representação pública a `req.user`. O middleware
`authorize(...roles)` usa exclusivamente `req.user.role`; claims de role no
token não são consideradas.

As rotas protegidas são `GET /api/users/me` e as operações de endereço em
`/api/users/me/addresses`. O ownership é sempre derivado de `req.user._id`;
não há `userId` confiável em body, query ou URL. Tokens ausentes, inválidos,
expirados, com assinatura inválida ou usuário removido retornam `401`;
permissão insuficiente retorna `403`; falhas de configuração ou Mongo
retornam `503`.

## Gate 5 — Product e Category MongoDB

O Gate 5 mantém `/api/produtos` e `/api/pedidos` intactos como API JSON
legada e adiciona o catálogo Mongo em `/api/catalog/products` e
`/api/catalog/categories`. GETs são públicos; POST, PUT e DELETE exigem
`authenticate` seguido de `authorize("admin")`.

Categorias geram slug normalizado, único e sem acentos. Produtos referenciam
categorias por `ObjectId` e só podem usar categorias existentes e ativas.
Categoria inexistente retorna `404`; categoria existente e inativa retorna
`409`. Preço é validado como número finito, não negativo e com até duas casas.
Categorias referenciadas por produtos não podem ser removidas (`409`).
Sem `MONGO_URI`, as rotas do catálogo retornam `503`, enquanto o CRUD JSON e
`/api/health` continuam independentes.
