#include <iostream>

#include <unitree/robot/channel/channel_factory.hpp>
#include <unitree/robot/go2/sport/sport_client.hpp>

int main(int argc, char** argv) {
  const char* interface_name = argc > 1 ? argv[1] : "eth0";
  unitree::robot::ChannelFactory::Instance()->Init(0, interface_name);

  unitree::robot::go2::SportClient sport_client(false);
  sport_client.SetTimeout(2.0F);
  sport_client.Init();
  const int32_t result = sport_client.StopMove();
  std::cout << "sdk2_stop_result=" << result << std::endl;

  unitree::robot::ChannelFactory::Instance()->Release();
  return result == 0 ? 0 : 1;
}
