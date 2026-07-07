## Fluxo novo

Qualquer e-mail pode se cadastrar, mas o acesso fica **bloqueado até um admin aprovar**. A ideia:

1. Usuário se cadastra em `/auth` → conta criada, mas marcada como **"aguardando aprovação"**.
2. Ao tentar logar antes da aprovação, o Supabase autentica, mas o app **desloga imediatamente** e mostra a mensagem: *"Sua conta ainda não foi aprovada por um administrador. Você receberá acesso assim que a liberação for feita."*
3. Admin abre `/admin/users`, vê os pendentes destacados no topo, e clica em **Aprovar** (ou **Rejeitar**).
4. Depois de aprovado, o usuário loga normal.

## Mudanças

**Banco (`user_roles`)**
- Adicionar coluna `approved boolean not null default false`.
- Backfill: marcar todos os usuários existentes hoje como `approved = true` (pra ninguém perder acesso).
- Ajustar trigger `handle_new_user`: `iara.oliveira@partnerbank.com.br` já entra com `approved = true` (admin auto-aprovado). Resto entra `approved = false`.
- Confirmar manualmente o e-mail da Débora (`email_confirmed_at = now()`) e deixar ela `approved = false` — o admin decide se libera.

**Auth (Supabase)**
- Ligar `auto_confirm_email: true` como você já pediu, pra ninguém mais ficar preso esperando link de confirmação.

**Frontend `useAuth`**
- Depois de `onAuthStateChange`, buscar `role` **e** `approved`.
- Se `approved = false`: `supabase.auth.signOut()` + toast/erro amigável explicando que precisa de aprovação. Nunca deixa a sessão persistir.

**Tela `/auth`**
- Abaixo do botão "Criar Conta", texto fixo: *"Novas contas passam por aprovação de um administrador antes do primeiro acesso."*
- Depois de um signup bem-sucedido: substituir o toast atual por *"Cadastro recebido! Um administrador vai aprovar seu acesso em breve."* + voltar pra tela de login (não redireciona pra dentro do app).
- Se o login for de alguém não aprovado, mostrar a mensagem clara em vez de "Invalid login credentials".

**Tela `/admin/users`**
- Nova seção no topo: **"Aguardando aprovação"** listando quem tem `approved = false`, com botões **Aprovar** e **Rejeitar** (rejeitar = deletar linha em `user_roles` + `auth.users`).
- Na lista principal, badge visual pra distinguir aprovado / pendente.
- Só admin acessa (RLS já garante isso via `has_role`).

## O que **não** muda

- Regra de role continua: `iara.oliveira@partnerbank.com.br` → `admin`, resto → `comercial`.
- Signup continua aberto pra qualquer domínio (você quis deixar assim).
- Nada nas edge functions, RLS de dossiê, cache, ranking, etc.

## Detalhe técnico (RLS)

A checagem de `approved` no frontend é UX — a proteção real é o RLS já existente nas tabelas de dossiê/histórico/etc., que exige `auth.uid()` presente. Como um usuário não aprovado é deslogado antes de qualquer request autenticado, ele não consegue ler nem escrever nada. Ainda assim, vou adicionar `approved = true` como pré-requisito nas policies principais que hoje só checam `auth.uid()`, pra fechar a porta caso alguém tente burlar o client.
