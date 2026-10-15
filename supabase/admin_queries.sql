-- =========================================================
-- CONSULTAS ADMINISTRATIVAS — XD4 ROBOTICS
-- Use somente no SQL Editor do Supabase.
-- São consultas de leitura e não alteram o banco.
-- Selecione apenas o bloco desejado antes de clicar em Run.
-- =========================================================

-- 1. USUÁRIOS CADASTRADOS
select
  users.email,
  coalesce(profiles.display_name, '-') as nome,
  coalesce(profiles.role, 'sem perfil') as perfil,
  users.email_confirmed_at is not null as email_confirmado,
  users.created_at as cadastrado_em,
  users.last_sign_in_at as ultimo_login
from auth.users as users
left join public.profiles as profiles
  on profiles.id = users.id
order by users.created_at desc;


-- 2. RESUMO DE USUÁRIOS E ACESSOS
select
  (select count(*) from auth.users) as usuarios_cadastrados,
  (select count(*) from auth.users where email_confirmed_at is not null) as emails_confirmados,
  (select count(*) from public.profiles) as perfis_criados,
  (select count(*) from public.login_logs) as logins_registrados;


-- 3. USUÁRIOS SEM PERFIL (O RESULTADO IDEAL É ZERO LINHAS)
select
  users.id,
  users.email,
  users.created_at
from auth.users as users
left join public.profiles as profiles
  on profiles.id = users.id
where profiles.id is null
order by users.created_at desc;


-- 4. HISTÓRICO DE LOGINS
select
  profiles.email,
  login_logs.logged_at,
  login_logs.source,
  login_logs.ip_address
from public.login_logs
join public.profiles
  on profiles.id = login_logs.user_id
order by login_logs.logged_at desc
limit 100;


-- 5. STATUS ATUAL DO ROBÔ
select
  robot_id,
  robot_online,
  network_online,
  sdk_connected,
  battery_percent,
  last_seen_at,
  case
    when last_seen_at is null then 'sem telemetria'
    when last_seen_at < now() - interval '30 seconds' then 'telemetria expirada'
    else 'telemetria atual'
  end as situacao_telemetria
from public.robot_status
order by robot_id;


-- 6. COMANDOS MAIS RECENTES
select
  robot_commands.id,
  profiles.email as solicitado_por,
  robot_commands.command,
  robot_commands.status,
  robot_commands.created_at,
  robot_commands.processed_at,
  robot_commands.error_message
from public.robot_commands
left join public.profiles
  on profiles.id = robot_commands.user_id
order by robot_commands.created_at desc
limit 100;


-- 7. COMANDOS AINDA PENDENTES
select
  id,
  robot_id,
  command,
  payload,
  created_at
from public.robot_commands
where status = 'queued'
order by created_at asc;


-- 8. ANÁLISES ORACLE MAIS RECENTES
select
  oracle_analyses.id,
  profiles.email as solicitado_por,
  oracle_analyses.status,
  oracle_analyses.created_at,
  oracle_analyses.completed_at,
  oracle_analyses.error_message
from public.oracle_analyses
left join public.profiles
  on profiles.id = oracle_analyses.user_id
order by oracle_analyses.created_at desc
limit 100;


-- 9. OPERAÇÕES COM FALHA
select
  'comando' as tipo,
  id,
  status,
  error_message,
  created_at
from public.robot_commands
where status = 'failed'

union all

select
  'oracle' as tipo,
  id,
  status,
  error_message,
  created_at
from public.oracle_analyses
where status = 'failed'
order by created_at desc;


-- 10. QUANTIDADE DE REGISTROS OPERACIONAIS
select
  (select count(*) from public.robot_commands) as total_comandos,
  (select count(*) from public.robot_commands where status = 'queued') as comandos_pendentes,
  (select count(*) from public.robot_commands where status = 'failed') as comandos_com_falha,
  (select count(*) from public.oracle_analyses) as total_analises,
  (select count(*) from public.oracle_analyses where status = 'queued') as analises_pendentes;
