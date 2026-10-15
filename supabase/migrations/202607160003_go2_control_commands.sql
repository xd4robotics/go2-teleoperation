-- Amplia os comandos para o painel integrado de SLAM e teleoperação do Go2.

alter table public.robot_commands
drop constraint if exists robot_commands_command_check;

alter table public.robot_commands
add constraint robot_commands_command_check check (
  command in (
    'forward',
    'backward',
    'rotate_left',
    'rotate_right',
    'stand_up',
    'stand_down',
    'arm',
    'disarm',
    'set_speed',
    'reset_map',
    'save_map',
    'stop',
    'emergency_stop',
    -- Mantidos apenas para filas criadas por versões anteriores do painel.
    'left',
    'right',
    'raise',
    'lower'
  )
);
