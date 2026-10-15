-- Adiciona o RecoveryStand oficial usado pela combinação L2 + X do RC.

alter table public.robot_commands
drop constraint if exists robot_commands_command_check;

alter table public.robot_commands
add constraint robot_commands_command_check check (
  command in (
    'move_analog',
    'forward',
    'backward',
    'rotate_left',
    'rotate_right',
    'stand_up',
    'stand_down',
    'recovery_stand',
    'arm',
    'disarm',
    'set_speed',
    'set_obstacle_avoidance',
    'damping',
    'reset_map',
    'save_map',
    'stop',
    'emergency_stop',
    -- Compatibilidade com filas criadas por versões anteriores.
    'left',
    'right',
    'raise',
    'lower'
  )
);
