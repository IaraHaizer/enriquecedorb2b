# Setup Local — GroupRadar

Guia para rodar o projeto **100% local** (frontend + Supabase + Edge Functions) e restaurar o dump completo do banco.

---

## 1. Pré-requisitos

Instale antes de começar:

- **Node 20+** e **bun** (ou npm/pnpm) — `curl -fsSL https://bun.sh/install | bash`
- **Docker Desktop** (obrigatório para Supabase local) — https://docs.docker.com/get-docker/
- **Supabase CLI** — https://supabase.com/docs/guides/cli/getting-started
  ```bash
  # macOS
  brew install supabase/tap/supabase
  # Linux / Windows: ver docs
  ```
- **Git** + acesso ao repositório

Verifique:
```bash
docker --version
supabase --version
bun --version
```

---

## 2. Clonar o repositório

```bash
git clone <URL_DO_REPO> groupradar
cd groupradar
bun install
```

---

## 3. Subir o Supabase local

Na raiz do projeto, **inicialize e suba** os containers (Postgres, GoTrue, PostgREST, Storage, Studio, Edge Runtime):

```bash
supabase start
```

Na primeira vez o Docker baixa as imagens (~5 min). Ao final, a CLI imprime algo como:

```
API URL:        http://127.0.0.1:54321
DB URL:         postgresql://postgres:postgres@127.0.0.1:54322/postgres
Studio URL:     http://127.0.0.1:54323
anon key:       eyJhbGciOi...   <-- copie
service_role:   eyJhbGciOi...   <-- copie
```

**Guarde essas chaves** — você vai usar em `.env` e nos secrets das functions.

> Estúdio web do banco local: http://127.0.0.1:54323

---

## 4. Restaurar o dump (schema + dados)

O arquivo `dump.sql` foi gerado com `pg_dump --schema=public` da Cloud. Restaure no Postgres local:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f dump.sql
```

Se aparecerem avisos `role "..." does not exist`, pode ignorar — o dump usa `--no-owner --no-privileges`, então o Postgres local atribui tudo para o usuário `postgres`.

Confirme:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "\dt public.*"
```

Deve listar as 6 tabelas (`empresas`, `dossies`, `user_roles`, etc).

---

## 5. Criar usuários no Auth local

O dump **não** inclui `auth.users` (schema gerenciado pelo Supabase). Crie usuários novos:

### Opção A — via Studio (http://127.0.0.1:54323)
1. Authentication → Users → **Add user** → criar com email/senha.
2. Copie o `UUID` gerado.
3. Atualize o `user_roles` com esse UUID:
   ```sql
   UPDATE public.user_roles
   SET id = '<NOVO_UUID>'
   WHERE email = 'seu@email.com';
   ```
   (Ou insira uma nova linha com `role = 'admin'` se a tabela estiver vazia.)

### Opção B — via SQL (rápido para o admin)
```sql
-- Cria usuário admin
INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, role, aud)
VALUES (
  gen_random_uuid(),
  'iara.oliveira@partnerbank.com.br',
  crypt('senha123', gen_salt('bf')),
  now(), 'authenticated', 'authenticated'
)
RETURNING id;

-- Pegue o id retornado e use no user_roles
INSERT INTO public.user_roles (id, email, role)
VALUES ('<ID_RETORNADO>', 'iara.oliveira@partnerbank.com.br', 'admin');
```

---

## 6. Configurar variáveis do frontend (`.env`)

Crie/edite **`.env`** na raiz com os valores **locais**:

```env
VITE_SUPABASE_PROJECT_ID="local"
VITE_SUPABASE_URL="http://127.0.0.1:54321"
VITE_SUPABASE_PUBLISHABLE_KEY="<anon key impresso no supabase start>"
```

> ⚠️ Não comite esse `.env` modificado — é só para ambiente local.

---

## 7. Configurar secrets das Edge Functions

A function `generate-dossier` precisa das seguintes chaves. Crie **`supabase/functions/.env`**:

```env
OPENROUTER_API_KEY=sk-or-...
APOLLO_API_KEY=...
GOOGLE_PLACES_API_KEY=AIza...
FIRECRAWL_API_KEY=fc-...
SEEKLOC_USER=...
SEEKLOC_PWD=...
SEEKLOC_EMP=...

# Já preenchidos pelo supabase start, mas mantenha:
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
```

> Cada analista usa as chaves dele (ou as suas, se for ambiente compartilhado). Não comite esse arquivo.

---

## 8. Servir as Edge Functions

Em um terminal separado:

```bash
supabase functions serve --env-file supabase/functions/.env
```

Endpoint: `http://127.0.0.1:54321/functions/v1/generate-dossier`

---

## 9. Rodar o frontend

```bash
bun run dev
```

Abra http://localhost:8080 (ou a porta que o Vite imprimir), faça login com o usuário criado no passo 5 e teste gerar um dossiê.

---

## 10. Comandos úteis

| Ação | Comando |
|---|---|
| Parar tudo | `supabase stop` |
| Resetar banco (apaga e roda migrations) | `supabase db reset` |
| Reaplicar o dump após reset | `psql "$DB_URL" -f dump.sql` |
| Ver logs das functions | `supabase functions serve` (já mostra) |
| Logs do Postgres | `docker logs supabase_db_groupradar` |

---

## 11. Troubleshooting

- **`permission denied for table X`** → faltou o `GRANT`. Rode no Studio:
  ```sql
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.<tabela> TO authenticated;
  GRANT ALL ON public.<tabela> TO service_role;
  ```
- **Login não funciona** → confirme que o usuário existe em `auth.users` **e** tem linha em `public.user_roles` com o mesmo `id`.
- **Function retorna 401** → verifique se está enviando o header `Authorization: Bearer <anon_key>` ou se o usuário está logado.
- **Porta 54321/54322/54323 ocupada** → `supabase stop` e tente de novo, ou edite `supabase/config.toml`.

---

Qualquer dúvida, abre uma issue no repo ou pinga o time. ✌️
