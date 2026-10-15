#include <cstdlib>
#include <iostream>
#include <string>
#include <thread>
#include <chrono>

#include <unitree/robot/channel/channel_factory.hpp>
#include <unitree/robot/go2/vui/vui_client.hpp>

int main(int argc, char** argv) {
  if (argc != 3) {
    std::cerr << "uso: set_go2_native_volume INTERFACE NIVEL_0_A_10\n";
    return 2;
  }

  const int requested = std::atoi(argv[2]);
  if (requested < 0 || requested > 10) {
    std::cerr << "nível deve estar entre 0 e 10\n";
    return 2;
  }

  unitree::robot::ChannelFactory::Instance()->Init(0, argv[1]);
  unitree::robot::go2::VuiClient client;
  client.SetTimeout(2.0f);
  client.Init();

  int previous = -1;
  const int get_ret = client.GetVolume(previous);
  const int set_ret = client.SetVolume(requested);
  std::this_thread::sleep_for(std::chrono::milliseconds(800));
  int confirmed = -1;
  const int confirm_ret = client.GetVolume(confirmed);

  std::cout << "anterior=" << previous << " get=" << get_ret
            << " solicitado=" << requested << " set=" << set_ret
            << " confirmado=" << confirmed << " confirm=" << confirm_ret
            << '\n';
  return (set_ret == 0 && confirm_ret == 0 && confirmed == requested) ? 0 : 1;
}
