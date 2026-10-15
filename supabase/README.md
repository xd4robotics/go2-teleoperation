# Banco Supabase

A migração em `migrations/202607150001_initial_schema.sql` cria:

- perfis vinculados ao Supabase Auth;
- histórico de logins;
- status/telemetria do robô;
- fila de comandos para o bridge da Jetson;
- fila de análises da Oracle;
- índices, triggers, RLS e publicação Realtime.

A migração `202607150002_sync_auth_profiles.sql` repara e mantém a sincronização entre usuários do Auth e a tabela pública de perfis.

A migração `202607160003_go2_control_commands.sql` adiciona os comandos de
rotação, postura, velocidade e mapa usados pelo painel integrado do Go2.

O fluxo administrativo não exige uma nova tabela ou coluna: `profiles.role` já
aceita os valores `operator` e `admin`, e as permissões existentes impedem que um
usuário comum altere o próprio papel. A criação de contas é feita pela API Auth
Admin no backend e, em seguida, o perfil sincronizado recebe o papel escolhido.

O arquivo `admin_queries.sql` reúne somente consultas de leitura para usuários, logins, status, comandos e análises. Ele não é uma migração e não deve ser executado como parte da criação do banco.

## Aplicação pelo Dashboard

1. Abra **SQL Editor** no projeto Supabase.
2. Crie uma nova consulta.
3. Cole e execute `202607150001_initial_schema.sql`.
4. Em uma nova consulta, cole e execute `202607150002_sync_auth_profiles.sql`.
5. Em uma nova consulta, cole e execute `202607160003_go2_control_commands.sql`.
6. Em **Authentication > Users**, use **Add user** para criar a primeira conta administrativa e marque o e-mail como confirmado.
7. Execute somente uma vez, trocando o e-mail pelo da conta criada:

   ```sql
   update public.profiles
   set role = 'admin'
   where email = 'email@empresa.com';
   ```

8. Em **Authentication**, desative o cadastro público de novos usuários. O login continuará funcionando e administradores continuarão criando contas pelo painel.
9. Copie a Project URL e a publishable key para o frontend e backend.
10. Copie a secret/service role key somente para o backend; ela é obrigatória para a tela **Usuários**.

As migrações são idempotentes, mas devem continuar versionadas e executadas na ordem do nome. Cadastro público e confirmação de e-mail são configurações do Supabase Auth e não devem ser alteradas por SQL. As contas criadas pelo administrador já são confirmadas pela API para poderem entrar imediatamente.

Não coloque a chave secret/service role em nenhuma variável `VITE_*`.
