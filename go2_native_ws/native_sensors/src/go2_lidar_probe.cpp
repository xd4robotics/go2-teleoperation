#include <unitree/idl/ros2/PointCloud2_.hpp>
#include <unitree/robot/channel/channel_factory.hpp>
#include <unitree/robot/channel/channel_subscriber.hpp>

#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <memory>
#include <string>
#include <thread>

using PointCloud = sensor_msgs::msg::dds_::PointCloud2_;

int main(int argc, char** argv) {
  const std::string interface = argc > 1 ? argv[1] : "eth0";
  const int duration_seconds = argc > 2 ? std::max(1, std::atoi(argv[2])) : 12;

  std::atomic<std::uint64_t> messages{0};
  std::atomic<std::uint64_t> points{0};
  std::atomic<bool> printed_metadata{false};

  std::cout << "Conectando ao DDS do Go2 pela interface " << interface << "...\n";
  unitree::robot::ChannelFactory::Instance()->Init(0, interface);

  auto subscriber = std::make_shared<unitree::robot::ChannelSubscriber<PointCloud>>(
      "rt/utlidar/cloud");
  subscriber->InitChannel([&](const void* raw_message) {
    const auto& cloud = *static_cast<const PointCloud*>(raw_message);
    messages.fetch_add(1, std::memory_order_relaxed);
    points.fetch_add(static_cast<std::uint64_t>(cloud.width()) * cloud.height(),
                     std::memory_order_relaxed);

    if (!printed_metadata.exchange(true)) {
      std::cout << "\nNuvem recebida:\n"
                << "  tópico DDS: rt/utlidar/cloud\n"
                << "  tópico ROS 2: /utlidar/cloud\n"
                << "  frame: " << cloud.header().frame_id() << "\n"
                << "  dimensões: " << cloud.width() << " x " << cloud.height() << "\n"
                << "  point_step: " << cloud.point_step() << " bytes\n"
                << "  dados: " << cloud.data().size() << " bytes\n"
                << "  campos:";
      for (const auto& field : cloud.fields()) {
        std::cout << ' ' << field.name() << "@" << field.offset();
      }
      std::cout << "\n\n";
    }
  }, 4);

  const auto started_at = std::chrono::steady_clock::now();
  for (int elapsed = 1; elapsed <= duration_seconds; ++elapsed) {
    std::this_thread::sleep_for(std::chrono::seconds(1));
    const auto count = messages.load(std::memory_order_relaxed);
    std::cout << "\rTempo: " << std::setw(2) << elapsed << " s | mensagens: " << count
              << " | pontos: " << points.load(std::memory_order_relaxed) << std::flush;
  }
  std::cout << '\n';

  const auto elapsed = std::chrono::duration<double>(
      std::chrono::steady_clock::now() - started_at).count();
  const auto count = messages.load(std::memory_order_relaxed);
  subscriber->CloseChannel();
  unitree::robot::ChannelFactory::Instance()->Release();

  if (count == 0) {
    std::cerr << "ERRO: nenhuma nuvem chegou do LiDAR nativo do Go2.\n";
    return 2;
  }

  std::cout << std::fixed << std::setprecision(2)
            << "LiDAR nativo OK: " << count << " mensagens, "
            << (count / elapsed) << " Hz.\n";
  return 0;
}
