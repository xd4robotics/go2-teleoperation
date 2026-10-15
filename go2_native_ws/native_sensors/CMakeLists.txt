cmake_minimum_required(VERSION 3.10)
project(go2_native_sensors LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

set(UNITREE_SDK_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../unitree_sdk2")
set(UNITREE_ARCH "${CMAKE_SYSTEM_PROCESSOR}")

find_package(Threads REQUIRED)

add_library(unitree_ddsc SHARED IMPORTED)
set_target_properties(unitree_ddsc PROPERTIES
  IMPORTED_LOCATION "${UNITREE_SDK_ROOT}/thirdparty/lib/${UNITREE_ARCH}/libddsc.so")

add_library(unitree_ddscxx SHARED IMPORTED)
set_target_properties(unitree_ddscxx PROPERTIES
  IMPORTED_LOCATION "${UNITREE_SDK_ROOT}/thirdparty/lib/${UNITREE_ARCH}/libddscxx.so")

add_library(unitree_sdk2 STATIC IMPORTED)
set_target_properties(unitree_sdk2 PROPERTIES
  IMPORTED_LOCATION "${UNITREE_SDK_ROOT}/lib/${UNITREE_ARCH}/libunitree_sdk2.a")

add_executable(go2_lidar_probe src/go2_lidar_probe.cpp)
target_include_directories(go2_lidar_probe PRIVATE
  "${UNITREE_SDK_ROOT}/include"
  "${UNITREE_SDK_ROOT}/thirdparty/include"
  "${UNITREE_SDK_ROOT}/thirdparty/include/ddscxx")
target_link_libraries(go2_lidar_probe PRIVATE
  unitree_sdk2 unitree_ddscxx unitree_ddsc Threads::Threads)

set_target_properties(go2_lidar_probe PROPERTIES
  BUILD_RPATH "${UNITREE_SDK_ROOT}/thirdparty/lib/${UNITREE_ARCH}")
