# C++ 代码检视指南

> 本指南重点关注内存安全、生命周期、API 设计、现代语言特性和性能。示例以 C++17/20/23 为基础。

## 目录

- [所有权与 RAII](#所有权与-raii)
- [智能指针选择指南](#智能指针选择指南)
- [生命周期与引用](#生命周期与引用)
- [复制与移动语义](#复制与移动语义)
- [const 正确性与 API 设计](#const-正确性与-api-设计)
- [错误处理与异常安全](#错误处理与异常安全)
- [现代 C++20/23 特性](#现代-c2023-特性)
- [constexpr 与 consteval](#constexpr-与-consteval)
- [并发](#并发)
- [性能与内存分配](#性能与内存分配)
- [模板与类型安全](#模板与类型安全)
- [测试](#测试)
- [工具与构建检查](#工具与构建检查)
- [检视清单](#检视清单)

---

## 所有权与 RAII

### 优先使用 RAII 和智能指针

使用 RAII 表达所有权。默认采用 `std::unique_ptr`，仅在共享生命周期时使用 `std::shared_ptr`。

```cpp
// ❌ 不佳：手工 new/delete 配合提前返回
Foo* make_foo() {
    Foo* foo = new Foo();
    if (!foo->Init()) {
        delete foo;
        return nullptr;
    }
    return foo;
}

// ✅ 推荐：使用 unique_ptr 实现 RAII
std::unique_ptr<Foo> make_foo() {
    auto foo = std::make_unique<Foo>();
    if (!foo->Init()) {
        return {};
    }
    return foo;
}
```

### 包装 C 资源

```cpp
// ✅ 推荐：用 unique_ptr 包装 FILE*
using FilePtr = std::unique_ptr<FILE, decltype(&fclose)>;

FilePtr open_file(const char* path) {
    return FilePtr(fopen(path, "rb"), &fclose);
}
```

### RAII 最佳实践

```cpp
// ✅ 推荐：用 RAII 包装 POSIX 文件描述符
class Fd {
    int fd_ = -1;
public:
    explicit Fd(int fd) : fd_(fd) {}
    ~Fd() { if (fd_ >= 0) ::close(fd_); }

    Fd(const Fd&) = delete;
    Fd& operator=(const Fd&) = delete;
    Fd(Fd&& o) noexcept : fd_(std::exchange(o.fd_, -1)) {}
    Fd& operator=(Fd&& o) noexcept {
        if (this != &o) {
            if (fd_ >= 0) ::close(fd_);
            fd_ = std::exchange(o.fd_, -1);
        }
        return *this;
    }

    int get() const { return fd_; }
    int release() { return std::exchange(fd_, -1); }
};
```

### 不要混用所有权管理方式

```cpp
// ❌ 不佳：直接 new 并将裸指针放入容器，释放责任不明确
std::vector<Widget*> widgets;
widgets.push_back(new Widget());
// 何时调用 delete？不明确。

// ✅ 推荐：容器存储 unique_ptr
std::vector<std::unique_ptr<Widget>> widgets;
widgets.push_back(std::make_unique<Widget>());
// vector 销毁时自动清理。
```

---

## 智能指针选择指南

### 决策矩阵

| 场景 | 指针类型 | 原因 |
|----------|---------|-----|
| 单一所有者 | `unique_ptr` | 零额外开销，所有权清晰 |
| 共享所有权，所有者数量较少 | `shared_ptr` | 引用计数，计数更新线程安全 |
| 不拥有对象的观察者 | `weak_ptr` | 打破循环引用，可检查对象是否存活 |
| 永不为空的引用 | 原始引用 `T&` | 不拥有对象，不能为 null |
| 可能为空的观察者 | 原始指针 `T*` | 不拥有对象，可以为 null |

### unique_ptr 足够时避免使用 shared_ptr

```cpp
// ❌ 不佳：不必要的共享所有权
class Window {
    std::shared_ptr<Renderer> renderer_;
public:
    Window() : renderer_(std::make_shared<Renderer>()) {}
};

// ✅ 推荐：独占所有权时使用 unique_ptr
class Window {
    std::unique_ptr<Renderer> renderer_;
public:
    Window() : renderer_(std::make_unique<Renderer>()) {}
};
```

### 使用 weak_ptr 打破循环引用

```cpp
// ❌ 不佳：循环引用导致内存泄漏
struct Node {
    std::shared_ptr<Node> parent;
    std::shared_ptr<Node> child;
};

// ✅ 推荐：用 weak_ptr 打断反向引用
struct Node {
    std::weak_ptr<Node> parent;    // 不拥有对象的反向引用
    std::shared_ptr<Node> child;   // 拥有对象的正向引用
};
```

---

## 生命周期与引用

### 避免悬空引用和视图

`std::string_view` 和 `std::span` 不拥有数据。确保数据所有者的生命周期长于视图。

```cpp
// ❌ 不佳：返回指向临时对象的 string_view
std::string_view bad_view() {
    std::string s = make_name();
    return s; // dangling
}

// ✅ 推荐：返回拥有数据的 string
std::string good_name() {
    return make_name();
}

// ✅ 推荐：视图绑定到调用方拥有的数据
std::string_view good_view(const std::string& s) {
    return s;
}
```

### Lambda 捕获

```cpp
// ❌ 不佳：捕获逃逸的引用
std::function<void()> make_task() {
    int value = 42;
    return [&]() { use(value); }; // dangling
}

// ✅ 推荐：按值捕获
std::function<void()> make_task() {
    int value = 42;
    return [value]() { use(value); };
}
```

### 留意临时对象生命周期延长的陷阱

```cpp
// ❌ 不佳：引用绑定的临时对象已经销毁
const std::string& name = get_name();  // 语句结束时临时对象即被销毁
use(name);  // 悬空引用

// ✅ 推荐：保存值
std::string name = get_name();
use(name);
```

---

## 复制与移动语义

### 零/三/五法则

通过 RAII 类型优先遵循零法则。自行持有资源时，显式定义或删除复制和移动操作。

```cpp
// ❌ 不佳：使用默认复制操作管理裸指针所有权
struct Buffer {
    int* data;
    size_t size;
    explicit Buffer(size_t n) : data(new int[n]), size(n) {}
    ~Buffer() { delete[] data; }
    // 隐式生成复制构造与赋值操作，导致重复 delete
};

// ✅ 推荐：用 std::vector 遵循零法则
struct Buffer {
    std::vector<int> data;
    explicit Buffer(size_t n) : data(n) {}
};
```

### 删除不需要的复制操作

```cpp
struct Socket {
    Socket() = default;
    ~Socket() { close(); }

    Socket(const Socket&) = delete;
    Socket& operator=(const Socket&) = delete;
    Socket(Socket&&) noexcept = default;
    Socket& operator=(Socket&&) noexcept = default;
};
```

### 显式使用 std::move

```cpp
// ❌ 不佳：应该移动却发生了复制
std::string name = get_name();
data_.push_back(name);  // copy

// ✅ 推荐：源对象不再需要时使用移动
std::string name = get_name();
data_.push_back(std::move(name));
```

---

## const 正确性与 API 设计

### 使用 const 和 explicit

```cpp
class User {
public:
    const std::string& name() const { return name_; }
    void set_name(std::string name) { name_ = std::move(name); }

private:
    std::string name_;
};

struct Millis {
    explicit Millis(int v) : value(v) {}
    int value;
};
```

### 避免对象切片

```cpp
struct Shape { virtual ~Shape() = default; };
struct Circle : Shape { void draw() const; };

// ❌ 不佳：将 Circle 切片为 Shape
void draw(Shape shape);

// ✅ 推荐：按引用传递
void draw(const Shape& shape);
```

### 使用 override 和 final

```cpp
struct Base {
    virtual void run() = 0;
};

struct Worker final : Base {
    void run() override {}
};
```

---

## 错误处理与异常安全

### 优先使用 RAII 清理资源

```cpp
// ✅ 推荐：由 RAII 处理异常时的清理
void process() {
    std::vector<int> data = load_data(); // 安全清理
    do_work(data);
}
```

### 不要在析构函数中抛出异常

```cpp
struct File {
    ~File() noexcept { close(); }
    void close();
};
```

### 使用 expected 类型返回可预期的失败

```cpp
// ✅ C++23: std::expected
#include <expected>

std::expected<int, ParseError> parse_int(std::string_view s) {
    try {
        return std::stoi(std::string(s));
    } catch (const std::invalid_argument&) {
        return std::unexpected(ParseError::InvalidFormat);
    } catch (const std::out_of_range&) {
        return std::unexpected(ParseError::OutOfRange);
    }
}

// ✅ Pre-C++23: std::optional
std::optional<int> parse_int(const std::string& s) {
    try {
        return std::stoi(s);
    } catch (...) {
        return std::nullopt;
    }
}
```

### 异常安全等级

- **不抛异常保证**：`noexcept`，适用于析构、交换和移动操作。
- **强保证**：操作成功，或失败时状态保持不变；可使用复制并交换惯用法。
- **基本保证**：发生异常时不泄漏资源，对象仍有效，但状态可能已改变。

```cpp
// ✅ 推荐：通过复制并交换提供强异常保证
void Container::push_back(const Item& item) {
    Container tmp(*this);    // copy
    tmp.push_back_impl(item); // 可能抛出异常，但 tmp 是副本
    swap(*this, tmp);         // 不抛出异常的交换操作
}
```

---

## 现代 C++20/23 特性

### 概念（Concepts，C++20）

```cpp
// ❌ 不佳：SFINAE 样板代码繁琐
template <typename T, std::enable_if_t<std::is_integral_v<T>, int> = 0>
T gcd(T a, T b) {
    while (b) { a %= b; std::swap(a, b); }
    return a;
}

// ✅ 推荐：concept 更易读且可组合
template <std::integral T>
T gcd(T a, T b) {
    while (b) { a %= b; std::swap(a, b); }
    return a;
}

// ✅ 定义自定义 concept
template <typename T>
concept Printable = requires(T t, std::ostream& os) {
    { os << t } -> std::convertible_to<std::ostream&>;
};

void log(const Printable auto& value) {
    std::cout << "[LOG] " << value << '\n';
}
```

### 范围与视图（C++20）

```cpp
#include <ranges>
#include <vector>
#include <numeric>

// ✅ 推荐：可组合的范围处理流水线
std::vector<int> scores = {85, 92, 67, 73, 98, 55};

auto top_scores = scores
    | std::views::filter([](int s) { return s >= 80; })
    | std::views::transform([](int s) { return s * 1.1; })  // bonus
    | std::views::take(3);

// 迭代时无需分配中间容器
for (double s : top_scores) {
    std::cout << s << ' ';
}
```

### 模块（C++20）

```cpp
// ✅ 模块接口单元（math.cppm）
export module math;

export int add(int a, int b) { return a + b; }
export constexpr double pi = 3.14159265358979;

// ✅ 模块实现单元（math_impl.cpp）
module math;

int internal_helper() { /* 不导出 */ }

// Consumer:
import math;
int result = add(1, 2);
```

**检视提示**：模块的工具链支持仍在完善。采用前确认构建系统（CMake 3.28+、MSVC 17.x、Clang 16+）是否支持。默认使用头文件仍较稳妥。

### 显式对象参数（Deducing this，C++23）

```cpp
// ❌ 不佳：使用冗长的 CRTP 实现静态多态
template <typename Derived>
struct Base {
    void call() { static_cast<Derived*>(this)->impl(); }
};

// ✅ 推荐：C++23 显式对象参数
struct Widget {
    template <typename Self>
    void log(this Self&& self) {
        // self 根据调用上下文为 Widget& 或 Widget&&
        std::cout << self.name << '\n';
    }
    std::string name;
};
```

---

## constexpr 与 consteval

### 何时使用 constexpr 或 consteval

- `constexpr`：既可以在编译期求值，也可以在运行时求值。
- `consteval`：**必须**在编译期求值，即立即函数。

```cpp
// ✅ constexpr：尽可能在编译期执行，否则在运行期执行
constexpr int factorial(int n) {
    int result = 1;
    for (int i = 2; i <= n; ++i) result *= i;
    return result;
}

constexpr int c = factorial(5);  // compile-time
int r = factorial(argc);          // runtime

// ✅ consteval：强制在编译期求值
consteval int forced_compiletime(int n) {
    return n * n;
}

constexpr int v = forced_compiletime(42);  // OK
// int v2 = forced_compiletime(argc);      // 错误：不是常量表达式
```

### 用编译期计算改善性能

```cpp
// ✅ 推荐：在编译期生成查找表
constexpr auto make_crc_table() {
    std::array<uint32_t, 256> table{};
    for (uint32_t i = 0; i < 256; ++i) {
        uint32_t crc = i;
        for (int j = 0; j < 8; ++j) {
            crc = (crc >> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
        }
        table[i] = crc;
    }
    return table;
}

static constexpr auto crc_table = make_crc_table();

// 运行时使用，无初始化开销
uint32_t crc32(const uint8_t* data, size_t len) {
    uint32_t crc = 0xFFFFFFFF;
    for (size_t i = 0; i < len; ++i) {
        crc = (crc >> 8) ^ crc_table[(crc ^ data[i]) & 0xFF];
    }
    return ~crc;
}
```

### 用 constinit 保证静态初始化

```cpp
// ✅ 推荐：避免静态初始化顺序问题
constinit int global_counter = 0;  // 保证静态初始化，而非动态初始化
```

---

## 并发

### 保护共享数据

```cpp
// ❌ 不佳：数据竞争
int counter = 0;
void inc() { counter++; }

// ✅ Good: atomic
std::atomic<int> counter{0};
void inc() { counter.fetch_add(1, std::memory_order_relaxed); }
```

### 使用 RAII 锁

```cpp
std::mutex mu;
std::vector<int> data;

void add(int v) {
    std::lock_guard<std::mutex> lock(mu);
    data.push_back(v);
}
```

### 优先使用 std::jthread 而非 std::thread（C++20）

```cpp
// ❌ 不佳：std::thread 需要手动 join
void run() {
    std::thread t([]{ do_work(); });
    // 忘记 join 会触发 std::terminate
}

// ✅ 推荐：jthread 在析构时自动 join
void run() {
    std::jthread t([](std::stop_token st) {
        while (!st.stop_requested()) {
            do_work();
        }
    });
    // 自动 join；停止令牌支持协作式取消
}
```

### 使用 std::execution 进行结构化并发（面向后续 C++26）

说明：在 C++23 中，使用 `std::jthread` 配合 `std::stop_token` 实现协作式取消。原指南预计 `std::execution` 库（P2300）将在 C++26 中提供。

---

## 性能与内存分配

### 避免重复分配

```cpp
// ❌ 不佳：反复重新分配
std::vector<int> build(int n) {
    std::vector<int> out;
    for (int i = 0; i < n; ++i) {
        out.push_back(i);
    }
    return out;
}

// ✅ 推荐：提前预留容量
std::vector<int> build(int n) {
    std::vector<int> out;
    out.reserve(static_cast<size_t>(n));
    for (int i = 0; i < n; ++i) {
        out.push_back(i);
    }
    return out;
}
```

### 字符串拼接

```cpp
// ❌ 不佳：重复分配
std::string join(const std::vector<std::string>& parts) {
    std::string out;
    for (const auto& p : parts) {
        out += p;
    }
    return out;
}

// ✅ 推荐：预留总容量
std::string join(const std::vector<std::string>& parts) {
    size_t total = 0;
    for (const auto& p : parts) {
        total += p.size();
    }
    std::string out;
    out.reserve(total);
    for (const auto& p : parts) {
        out += p;
    }
    return out;
}
```

### 小缓冲区优化（SBO）

```cpp
// ✅ 推荐：少量数据避免堆分配
void process(const char* name) {
    // 短名称使用栈，仅长名称使用堆
    std::string buf;
    buf.reserve(64);  // 通常通过短字符串优化（SSO）保留在栈上
    buf = name;
    // ...
}
```

### 使用 std::span 创建零复制视图

```cpp
// ❌ 不佳：复制整个 vector
void process(std::vector<int> data);

// ✅ 推荐：使用不拥有数据的视图，兼容 vector、array 和 C 数组
void process(std::span<const int> data);

std::vector<int> v = {1, 2, 3};
process(v);             // 不发生复制
int arr[] = {4, 5, 6};
process(arr);           // 不发生复制
```

---

## 模板与类型安全

### 优先使用受约束模板（C++20）

```cpp
// ❌ 不佳：过度泛化
template <typename T>
T add(T a, T b) {
    return a + b;
}

// ✅ Good: constrained
template <typename T>
requires std::is_integral_v<T>
T add(T a, T b) {
    return a + b;
}
```

### 使用 static_assert 检查不变量

```cpp
template <typename T>
struct Packet {
    static_assert(std::is_trivially_copyable_v<T>,
        "Packet payload must be trivially copyable");
    T payload;
};
```

### 避免模板膨胀

```cpp
// ❌ 不佳：仅一个方法不同，却为每个 T 实例化整个模板
template <typename T>
class Service {
    void connect() { /* 100 行相同代码 */ }
    void process(T item) { /* type-specific */ }
};

// ✅ 推荐：将与类型无关的代码提取到非模板基类
class ServiceBase {
protected:
    void connect() { /* 100 行共享代码 */ }
};

template <typename T>
class Service : public ServiceBase {
    void process(T item) { /* type-specific */ }
};
```

---

## 测试

### 框架选择

| 框架 | 最适合的场景 |
|-----------|----------|
| **Google Test（GTest）** | 大型项目、CI、GMock 集成 |
| **Catch2** | 仅头文件、BDD 风格、现代 C++ |
| **doctest** | 轻量、单头文件、编译速度快 |

### Google Test 基础

```cpp
#include <gtest/gtest.h>
#include "parser.h"

TEST(ParserTest, EmptyInputReturnsNull) {
    auto token = parse("");
    EXPECT_EQ(token, nullptr);
}

TEST(ParserTest, ValidInteger) {
    auto token = parse("42");
    ASSERT_NE(token, nullptr);
    EXPECT_EQ(token->type, TokenType::Int);
    EXPECT_EQ(token->value, 42);
}

TEST(ParserTest, NegativeNumber) {
    auto token = parse("-7");
    ASSERT_NE(token, nullptr);
    EXPECT_EQ(token->value, -7);
}
```

### 测试夹具

```cpp
class DatabaseTest : public ::testing::Test {
protected:
    void SetUp() override {
        db_ = std::make_unique<Database>(":memory:");
        db_->execute("CREATE TABLE users (id INTEGER, name TEXT)");
    }

    void TearDown() override {
        db_.reset();
    }

    std::unique_ptr<Database> db_;
};

TEST_F(DatabaseTest, InsertAndQuery) {
    db_->execute("INSERT INTO users VALUES (1, 'Alice')");
    auto rows = db_->query("SELECT * FROM users");
    ASSERT_EQ(rows.size(), 1);
    EXPECT_EQ(rows[0].get<std::string>("name"), "Alice");
}

TEST_F(DatabaseTest, EmptyTableReturnsNoRows) {
    auto rows = db_->query("SELECT * FROM users");
    EXPECT_TRUE(rows.empty());
}
```

### 使用 GMock 创建模拟对象

```cpp
#include <gmock/gmock.h>

class HttpClient {
public:
    virtual ~HttpClient() = default;
    virtual HttpResponse get(const std::string& url) = 0;
};

class MockHttpClient : public HttpClient {
public:
    MOCK_METHOD(HttpResponse, get, (const std::string& url), (override));
};

TEST(UserServiceTest, FetchesUserProfile) {
    MockHttpClient client;
    EXPECT_CALL(client, get("https://api.example.com/user/1"))
        .WillOnce(Return(HttpResponse{200, R"({"name":"Alice"})"}));

    UserService svc(&client);
    auto profile = svc.get_profile(1);
    EXPECT_EQ(profile.name, "Alice");
}
```

### 测试异常安全性

```cpp
TEST(AllocatorTest, ThrowsOnOverflow) {
    EXPECT_THROW(allocate(SIZE_MAX), std::bad_alloc);
}

TEST(AllocatorTest, NoLeakOnException) {
    // 在 ASan 下运行，确认抛出异常时没有泄漏
    try {
        auto buf = allocate(1024);
        throw std::runtime_error("simulated failure");
    } catch (...) {
        // ASan 会发现泄漏
    }
}
```

---

## 工具与构建检查

```bash
# Warnings
clang++ -Wall -Wextra -Werror -Wconversion -Wshadow -std=c++20 ...

# 检测器（调试构建）
clang++ -fsanitize=address,undefined -fno-omit-frame-pointer -g ...
clang++ -fsanitize=thread -fno-omit-frame-pointer -g ...

# 静态分析
clang-tidy src/*.cpp -- -std=c++20

# Formatting
clang-format -i src/*.cpp include/*.h
```

### 推荐的安全编译选项

```bash
# 新代码启用严格模式
clang++ -std=c++20 -Wall -Wextra -Werror -Wshadow -Wconversion \
        -Wsign-conversion -Wold-style-cast -Wnon-virtual-dtor \
        -Woverloaded-virtual -Wnull-dereference -Wformat=2 \
        -fsanitize=address,undefined -fno-omit-frame-pointer
```

---

## 检视清单

### 安全与生命周期
- [ ] 所有权明确，使用 RAII 并默认采用 unique_ptr
- [ ] 不存在悬空引用或视图
- [ ] 拥有资源的类型遵循零/三/五法则
- [ ] 业务逻辑中不直接使用原始 new/delete
- [ ] 析构函数为 noexcept 且不会抛出异常
- [ ] 智能指针类型与所有权语义一致：独占、共享或弱引用
- [ ] shared_ptr 不形成循环，反向引用使用 weak_ptr

### API 与设计
- [ ] 一致地遵守 const 正确性
- [ ] 构造函数在需要时使用 explicit
- [ ] 虚函数使用 override/final
- [ ] 不发生对象切片，使用引用或指针传参
- [ ] 使用 Concepts 约束模板参数（C++20）

### 现代语言特性
- [ ] 有收益时使用 constexpr 进行编译期计算
- [ ] 数据处理流水线优先使用 Ranges，而非手写循环（C++20）
- [ ] 新代码优先使用 std::jthread，而非 std::thread（C++20）
- [ ] 可用时通过 std::expected 处理错误（C++23）

### 并发
- [ ] 共享数据通过互斥锁或原子操作保护
- [ ] 加锁顺序一致
- [ ] 持锁期间不执行阻塞操作

### 性能
- [ ] 通过 reserve、move、span 避免不必要的分配
- [ ] 热点路径避免复制
- [ ] 算法复杂度合理

### 测试与工具
- [ ] 单元测试覆盖正常路径、错误路径和边界情况
- [ ] 开启警告时构建无警告
- [ ] 关键代码路径使用运行时检查工具
- [ ] 已处理 clang-tidy 等静态分析结果
