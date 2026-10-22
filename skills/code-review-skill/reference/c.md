# C 代码检视指南

> 本指南重点关注内存安全、未定义行为、可移植性、测试和安全编码。示例以 C11/C17 为基础。

## 目录

- [指针与缓冲区安全](#指针与缓冲区安全)
- [所有权与资源管理](#所有权与资源管理)
- [未定义行为陷阱](#未定义行为陷阱)
- [整数类型与溢出](#整数类型与溢出)
- [错误处理](#错误处理)
- [并发](#并发)
- [宏与预处理器](#宏与预处理器)
- [API 设计与 const](#api-设计与-const)
- [安全编码实践](#安全编码实践)
- [跨平台可移植性](#跨平台可移植性)
- [测试](#测试)
- [工具与构建检查](#工具与构建检查)
- [检视清单](#检视清单)

---

## 指针与缓冲区安全

### 始终随缓冲区传递大小

```c
// ❌ 不佳：忽略目标缓冲区大小
bool copy_name(char *dst, size_t dst_size, const char *src) {
    strcpy(dst, src);
    return true;
}

// ✅ 推荐：校验大小并添加字符串终止符
bool copy_name(char *dst, size_t dst_size, const char *src) {
    size_t len = strlen(src);
    if (len + 1 > dst_size) {
        return false;
    }
    memcpy(dst, src, len + 1);
    return true;
}
```

### 避免危险 API

优先使用 `snprintf`、`fgets` 和显式边界检查，避免 `gets`、`strcpy` 或 `sprintf`。

```c
// ❌ 不佳：无边界限制的写入
sprintf(buf, "%s", input);

// ✅ 推荐：限制写入边界
snprintf(buf, buf_size, "%s", input);
```

### 使用合适的复制原语

```c
// ❌ 不佳：对重叠区域使用 memcpy
memcpy(dst, src, len);

// ✅ 推荐：用 memmove 处理重叠区域
memmove(dst, src, len);
```

### 校验指针参数

```c
// ❌ 不佳：未检查 NULL
int process(char *buf, size_t len) {
    buf[0] = '\0';
    return 0;
}

// ✅ 推荐：使用前先校验
int process(char *buf, size_t len) {
    if (!buf || len == 0) {
        return -EINVAL;
    }
    buf[0] = '\0';
    return 0;
}
```

### 留意指向指针的指针所带来的陷阱

```c
// ❌ 不佳：调用方无法区分成功与失败
void allocate(int **out) {
    *out = malloc(sizeof(int));
}

// ✅ 推荐：返回状态，仅在成功时设置输出
int allocate(int **out) {
    if (!out) return -EINVAL;
    int *p = malloc(sizeof(int));
    if (!p) return -ENOMEM;
    *out = p;
    return 0;
}
```

---

## 所有权与资源管理

### 一次分配，对应一次释放

跟踪所有权，并在每一条错误路径上清理资源。

```c
// ✅ 推荐：通过清理标签避免资源泄漏
int load_file(const char *path) {
    int rc = -1;
    FILE *f = NULL;
    char *buf = NULL;

    f = fopen(path, "rb");
    if (!f) {
        goto cleanup;
    }
    buf = malloc(4096);
    if (!buf) {
        goto cleanup;
    }

    if (fread(buf, 1, 4096, f) == 0) {
        goto cleanup;
    }

    rc = 0;

cleanup:
    free(buf);
    if (f) {
        fclose(f);
    }
    return rc;
}
```

### 记录所有权转移规则

```c
// ✅ 推荐：用注释明确由调用方取得所有权
// 调用方必须对返回的缓冲区调用 free()。
char *read_line(FILE *f);

// ✅ 推荐：用注释明确被调用方不取得所有权
// 此函数借用 `buf`，所有权仍归调用方。
int parse_header(const char *buf, size_t len, struct Header *out);
```

### 只释放一次，并将指针置为 NULL

```c
// ❌ 不佳：可能重复释放
void destroy(struct Cache *c) {
    free(c->entries);
    // 调用方可能再次调用 destroy()，导致重复释放
}

// ✅ 推荐：释放后置为 NULL，防止重复释放
void destroy(struct Cache *c) {
    if (!c) return;
    free(c->entries);
    c->entries = NULL;
    c->count = 0;
}
```

---

## 未定义行为陷阱

### 有符号整数溢出

C 中的有符号整数溢出属于未定义行为；无符号整数溢出则发生回绕。

```c
// ❌ 不佳：有符号整数溢出属于未定义行为
int sum = INT_MAX + 1;  // 未定义行为

// ✅ 推荐：在溢出前检查
if (a > 0 && b > INT_MAX - a) {
    return -EOVERFLOW;
}
int sum = a + b;
```

### 悬空指针

```c
// ❌ 不佳：返回指向局部数组的指针
char *greet(void) {
    char buf[64];
    snprintf(buf, sizeof(buf), "hello");
    return buf;  // 未定义行为：函数返回后 buf 已失效
}

// ✅ 推荐：由调用方提供缓冲区，或使用静态存储
void greet(char *out, size_t out_size) {
    snprintf(out, out_size, "hello");
}
```

### 未初始化变量

```c
// ❌ 不佳：x 的值不确定
int x;
if (x > 0) { /* 未定义行为：读取未初始化的自动变量 */ }

// ✅ 推荐：始终初始化
int x = 0;
if (x > 0) { /* well-defined */ }
```

### 违反序列点规则

```c
// ❌ 不佳：操作数求值顺序导致未定义行为
int i = 0;
int a[] = { i++, i++ };  // 未定义行为：两次修改之间没有序列点

// ❌ 不佳：修改与读取之间没有序列点
int j = i + i++;  // UB

// ✅ 推荐：拆成独立语句
int a0 = i++;
int a1 = i++;
int a[] = { a0, a1 };
```

### 违反严格别名规则

```c
// ❌ 不佳：违反严格别名规则
float f = 3.14f;
int i = *(int *)&f;  // UB

// ✅ 推荐：使用 memcpy 或 union（C11 允许通过 union 进行类型双关）
int i;
memcpy(&i, &f, sizeof(i));

// ✅ C11 中也可采用：
union { float f; int i; } u;
u.f = 3.14f;
int i = u.i;
```

### 移位操作

```c
// ❌ 不佳：位移量为负数或不小于类型位宽时属于未定义行为
int x = 1 << 32;     // int 为 32 位时属于未定义行为
int y = 1 << -1;     // UB

// ✅ 推荐：校验位移量
if (shift >= 0 && shift < (int)(sizeof(int) * CHAR_BIT)) {
    int result = 1 << shift;
}
```

---

## 整数类型与溢出

### 避免有符号与无符号类型混用产生意外结果

```c
// ❌ 不佳：负数转换为较大的 size_t
int len = -1;
size_t n = len;  // 回绕为 SIZE_MAX

// ✅ 推荐：转换前校验
if (len < 0) {
    return -1;
}
size_t n = (size_t)len;
```

### 检查大小计算中的溢出

```c
// ❌ 不佳：乘法可能溢出
size_t bytes = count * sizeof(Item);

// ✅ 推荐：乘法前检查
if (count > SIZE_MAX / sizeof(Item)) {
    return NULL;
}
size_t bytes = count * sizeof(Item);
```

### 二进制协议使用固定宽度类型

```c
// ❌ 不佳：int 大小随平台变化
struct PacketHeader {
    int type;
    int length;
};

// ✅ 推荐：传输格式使用明确的位宽
#include <stdint.h>
struct PacketHeader {
    uint32_t type;
    uint32_t length;
};
```

### 留意隐式类型提升

```c
// ❌ 不佳：uint8_t 在算术运算中提升为 int
uint8_t a = 200, b = 100;
uint8_t sum = a + b;  // truncation: 300 → 44

// ✅ 推荐：明确所需位宽
uint16_t sum = (uint16_t)a + (uint16_t)b;  // 300
```

---

## 错误处理

### 始终检查返回值

```c
// ❌ 不佳：忽略错误
fread(buf, 1, size, f);

// ✅ 推荐：处理错误
size_t read = fread(buf, 1, size, f);
if (read != size && ferror(f)) {
    return -1;
}
```

### 保持错误处理约定一致

- 使用清晰约定，例如 0 表示成功、负值表示失败。
- 记录成功和失败情况下的所有权规则。
- 使用 `errno` 时，仅在实际失败时设置它。

```c
// ✅ 推荐：通过 errno 明确错误约定
// 成功返回 0，失败返回 -1 并设置 errno。
// 失败时不修改 *out。
int parse_int(const char *s, int *out);
```

### 避免跨函数边界依赖 errno

```c
// ❌ 不佳：中间的函数调用可能覆盖 errno
errno = 0;
long val = strtol(s, &end, 10);
log_debug("parsed: %ld", val);  // 可能修改 errno！
if (errno != 0) { /* unreliable */ }

// ✅ 推荐：立即保存 errno
errno = 0;
long val = strtol(s, &end, 10);
int saved_errno = errno;
log_debug("parsed: %ld", val);
if (saved_errno != 0) { /* reliable */ }
```

---

## 并发

### volatile 不能替代同步

```c
// ❌ 不佳：数据竞争
volatile int stop = 0;
void worker(void) {
    while (!stop) { /* ... */ }
}

// ✅ Good: C11 atomics
_Atomic int stop = 0;
void worker(void) {
    while (!atomic_load(&stop)) { /* ... */ }
}
```

### 使用互斥锁保护共享状态

使用 `pthread_mutex_t` 或等价机制保护共享数据。避免持锁期间执行 I/O。

```c
// ✅ 推荐：互斥锁配合 RAII 风格的清理
static pthread_mutex_t g_lock = PTHREAD_MUTEX_INITIALIZER;
static int g_counter = 0;

void increment(void) {
    pthread_mutex_lock(&g_lock);
    g_counter++;
    pthread_mutex_unlock(&g_lock);
}
```

### 避免锁顺序问题

```c
// ❌ 不佳：加锁顺序不一致，导致死锁
// Thread 1: lock(A); lock(B);
// Thread 2: lock(B); lock(A);

// ✅ 推荐：始终按相同顺序获取锁
// 所有线程均采用：lock(A); lock(B);
```

---

## 宏与预处理器

### 给宏参数加括号

```c
// ❌ 不佳：宏存在副作用
#define MIN(a, b) ((a) < (b) ? (a) : (b))
int x = MIN(i++, j++);  // 参数会被求值两次

// ✅ 推荐：使用 static inline 函数
static inline int min_int(int a, int b) {
    return a < b ? a : b;
}
```

### 多语句宏

```c
// ❌ 不佳：在不带花括号的 if-else 中失效
#define LOG_AND_RETURN(msg) \
    fprintf(stderr, "%s\n", msg); \
    return -1

// ✅ Good: do { ... } while(0) idiom
#define LOG_AND_RETURN(msg) do { \
    fprintf(stderr, "%s\n", msg); \
    return -1; \
} while (0)
```

### 头文件包含保护

```c
// ✅ 推荐：使用传统的头文件包含保护
#ifndef MY_HEADER_H
#define MY_HEADER_H
// ... declarations ...
#endif /* MY_HEADER_H */

// ✅ 也可采用以下方式（非标准，但广泛支持）：
#pragma once
```

---

## API 设计与 const

### const 正确性与大小参数

```c
// ✅ 推荐：明确大小，并用 const 修饰输入
int hash_bytes(const uint8_t *data, size_t len, uint8_t *out);
```

### 说明参数是否允许为空

明确记录指针是否允许为 NULL。可以时优先返回错误码，而非仅返回 NULL。

```c
// ✅ 推荐：在头文件中说明接口约定
// @param name  非 NULL、以 NUL 结尾的字符串。
// @param out    非 NULL 的输出指针。
// @return 成功返回 0；name 或 out 为 NULL 时返回 -EINVAL。
int lookup(const char *name, struct Result *out);
```

### 使用不透明类型进行封装

```c
// ✅ 推荐：头文件仅暴露指针
typedef struct Parser Parser;

Parser *parser_create(const char *input);
int parser_next(Parser *p, struct Token *out);
void parser_destroy(Parser *p);
```

---

## 安全编码实践

### CERT C：缓冲区溢出防护

```c
// ❌ 不佳：strncpy 不保证以 NUL 结尾
char dst[32];
strncpy(dst, src, sizeof(dst));  // src 长度不小于 32 字节时，dst 不包含终止符！

// ✅ 推荐：strncpy 后显式添加 NUL 终止符
char dst[32];
strncpy(dst, src, sizeof(dst) - 1);
dst[sizeof(dst) - 1] = '\0';

// ✅ 更好：使用 snprintf 进行有长度限制的字符串复制
char dst[32];
snprintf(dst, sizeof(dst), "%s", src);
```

### 格式化字符串漏洞

```c
// ❌ 不佳：格式字符串由用户控制
printf(user_input);  // 若 user_input 为 "%x %x %x"，则会读取栈内容

// ✅ 推荐：始终使用格式字符串字面量
printf("%s", user_input);
```

### 内存分配中的整数溢出

```c
// ❌ 不佳：调用 malloc 前，count * size 可能已经溢出
void *items = malloc(count * sizeof(Item));

// ✅ 推荐：检查溢出
if (count != 0 && SIZE_MAX / count < sizeof(Item)) {
    errno = ENOMEM;
    return NULL;
}
void *items = malloc(count * sizeof(Item));

// ✅ 也可使用 calloc（内部会检查）
Item *items = calloc(count, sizeof(Item));
```

### 校验外部输入长度

```c
// ❌ 不佳：信任头部声明的长度
struct Msg { uint32_t len; char data[]; };
void handle(struct Msg *m) {
    char buf[256];
    memcpy(buf, m->data, m->len);  // 攻击者可以控制 m->len
}

// ✅ 推荐：使用前先校验
void handle(struct Msg *m, size_t total_size) {
    if (m->len > total_size - sizeof(struct Msg)) {
        return -EINVAL;
    }
    char buf[256];
    if (m->len > sizeof(buf)) {
        return -E2BIG;
    }
    memcpy(buf, m->data, m->len);
}
```

### 避免检查与使用之间的竞态条件（TOCTOU）

```c
// ❌ 不佳：先检查后使用存在 TOCTOU 竞态
if (access(path, R_OK) == 0) {
    FILE *f = fopen(path, "r");  // 在 access() 与 fopen() 之间，文件可能发生变化
}

// ✅ 推荐：直接尝试操作并检查结果
FILE *f = fopen(path, "r");
if (!f) {
    // 处理错误（ENOENT、EACCES 等）
}
```

### 安全创建临时文件

```c
// ❌ 不佳：名称可预测
char path[] = "/tmp/myapp_XXXXXX";
FILE *f = fopen(path, "w");  // 名称可预测，存在竞态条件

// ✅ 推荐：mkstemp 原子地创建并打开文件
char tmpl[] = "/tmp/myapp_XXXXXX";
int fd = mkstemp(tmpl);
if (fd < 0) { /* 处理错误 */ }
FILE *f = fdopen(fd, "w");
```

---

## 跨平台可移植性

### 预处理条件的最佳实践

```c
// ❌ 不佳：嵌套的 #ifdef 难以维护
#ifdef _WIN32
    #ifdef _WIN64
        // 64 位 Windows
    #else
        // 32 位 Windows
    #endif
#else
    #ifdef __linux__
        // Linux
    #endif
#endif

// ✅ 推荐：用特性宏封装差异
#if defined(PLATFORM_WINDOWS)
    #include "platform_win.h"
#elif defined(PLATFORM_LINUX)
    #include "platform_linux.h"
#elif defined(PLATFORM_MACOS)
    #include "platform_macos.h"
#else
    #error "Unsupported platform"
#endif
```

### 字节序（大端与小端）

```c
// ❌ 不佳：假设使用小端序
uint32_t read_u32(const uint8_t *buf) {
    return *(const uint32_t *)buf;  // 存在对齐和字节序问题
}

// ✅ 推荐：显式处理字节序
static inline uint32_t read_u32_le(const uint8_t *buf) {
    return (uint32_t)buf[0]
         | ((uint32_t)buf[1] << 8)
         | ((uint32_t)buf[2] << 16)
         | ((uint32_t)buf[3] << 24);
}

static inline uint32_t read_u32_be(const uint8_t *buf) {
    return ((uint32_t)buf[0] << 24)
         | ((uint32_t)buf[1] << 16)
         | ((uint32_t)buf[2] << 8)
         | (uint32_t)buf[3];
}
```

### 考虑内存对齐的访问

```c
// ❌ 不佳：未对齐访问在许多架构上属于未定义行为
uint32_t val = *(const uint32_t *)ptr;

// ✅ 推荐：memcpy 不受对齐方式影响
uint32_t val;
memcpy(&val, ptr, sizeof(val));
```

### 可移植代码避免平台专用扩展

```c
// ❌ 不佳：在共享代码中使用 GCC 扩展
typeof(x) y = x;

// ✅ 推荐：使用标准 C，或隔离扩展
// 在平台专用头文件中：
#ifdef __GNUC__
    #define TYPEOF(x) typeof(x)
#else
    #define TYPEOF(x) decltype(x)  /* C++23 或编译器专用写法 */
#endif
```

### 检测功能支持，而非直接判断平台

```c
// ❌ 不佳：因为是 Linux 就假设支持 POSIX
#ifdef __linux__
    #include <sys/mman.h>
#endif

// ✅ 推荐：通过 CMake/configure 检测特性
#ifdef HAVE_MMAP
    #include <sys/mman.h>
#endif
```

---

## 测试

### 选择测试框架

| 框架 | 使用场景 | 说明 |
|-----------|----------|-------|
| **Unity** | 嵌入式或裸机 | 单文件、无依赖、兼容 C89 |
| **CUnit** | 桌面程序或 CI | 丰富的断言，支持 HTML/XML 输出 |
| **CMocka** | 系统级代码 | 通过函数指针模拟，支持 `setjmp`/`longjmp` |

### Unity 基本测试结构

```c
#include "unity.h"
#include "parser.h"

void setUp(void) { /* 在每个测试前运行 */ }
void tearDown(void) { /* 在每个测试后运行 */ }

void test_parse_empty_string_returns_null(void) {
    struct Token *t = parse("");
    TEST_ASSERT_NULL(t);
}

void test_parse_valid_integer(void) {
    struct Token *t = parse("42");
    TEST_ASSERT_NOT_NULL(t);
    TEST_ASSERT_EQUAL_INT(TOKEN_INT, t->type);
    TEST_ASSERT_EQUAL_INT(42, t->value);
    token_free(t);
}

void test_parse_negative_number(void) {
    struct Token *t = parse("-7");
    TEST_ASSERT_NOT_NULL(t);
    TEST_ASSERT_EQUAL_INT(-7, t->value);
    token_free(t);
}

int main(void) {
    UNITY_BEGIN();
    RUN_TEST(test_parse_empty_string_returns_null);
    RUN_TEST(test_parse_valid_integer);
    RUN_TEST(test_parse_negative_number);
    return UNITY_END();
}
```

### 测试隔离：模拟系统调用

```c
// ✅ 推荐：注入依赖以便测试
// 生产代码：
struct FileOps {
    int (*read)(void *buf, size_t size, void *ctx);
    void *ctx;
};

int load_config(const struct FileOps *ops, struct Config *out);

// 测试代码：
static int mock_read(void *buf, size_t size, void *ctx) {
    const char *data = (const char *)ctx;
    size_t len = strlen(data);
    if (len < size) size = len;
    memcpy(buf, data, size);
    return (int)size;
}

void test_load_config_with_mock(void) {
    const char *fake_data = "key=value\n";
    struct FileOps ops = { .read = mock_read, .ctx = (void *)fake_data };
    struct Config cfg;
    int rc = load_config(&ops, &cfg);
    TEST_ASSERT_EQUAL_INT(0, rc);
    TEST_ASSERT_EQUAL_STRING("value", cfg.key);
}
```

### 使用运行时检查工具检测内存泄漏

```bash
# 在 AddressSanitizer 下运行测试
cc -fsanitize=address -fno-omit-frame-pointer -g -o test_runner tests/*.c src/*.c
./test_runner

# 在 Valgrind 下运行测试
cc -g -O0 -o test_runner tests/*.c src/*.c
valgrind --leak-check=full --error-exitcode=1 ./test_runner
```

```c
// ✅ 推荐：测试错误路径不会泄漏资源
void test_parse_invalid_frees_resources(void) {
    // Valgrind/ASan 会发现此调用产生的泄漏
    struct Token *t = parse("not_a_number");
    TEST_ASSERT_NULL(t);
    // 如果 parse() 分配了内部状态，却忘记在出错时释放，
    // 检测器就会报告问题。
}
```

### 系统性测试边界情况

```c
void test_edge_cases(void) {
    // 零长度输入
    TEST_ASSERT_EQUAL_INT(-EINVAL, process(NULL, 0));

    // 允许的最大输入
    char buf[256];
    memset(buf, 'a', sizeof(buf) - 1);
    buf[sizeof(buf) - 1] = '\0';
    TEST_ASSERT_EQUAL_INT(0, process(buf, sizeof(buf) - 1));

    // 超过限制一个字节
    TEST_ASSERT_EQUAL_INT(-E2BIG, process(buf, sizeof(buf)));
}
```

---

## 工具与构建检查

```bash
# Warnings
clang -Wall -Wextra -Werror -Wconversion -Wshadow -std=c11 ...

# 检测器（调试构建）
clang -fsanitize=address,undefined -fno-omit-frame-pointer -g ...
clang -fsanitize=thread -fno-omit-frame-pointer -g ...

# 静态分析
clang-tidy src/*.c -- -std=c11
cppcheck --enable=warning,performance,portability src/

# Formatting
clang-format -i src/*.c include/*.h
```

### CI 集成清单

```bash
# C 项目的典型 CI 流水线
clang -Wall -Wextra -Werror -std=c11 -c src/*.c        # 启用严格警告进行编译
clang -fsanitize=address,undefined -g -o test test/*.c src/*.c  # 启用检测器构建
./test                                                   # 运行测试
valgrind --leak-check=full --error-exitcode=1 ./test    # 内存检查
cppcheck --error-exitcode=1 --enable=all src/            # 静态分析
```

---

## 检视清单

### 内存与未定义行为
- [ ] 所有缓冲区都有显式大小参数
- [ ] 不存在越界访问或超出对象范围的指针运算
- [ ] 不存在释放后使用或读取未初始化内存
- [ ] 遵守有符号溢出和移位规则
- [ ] 遵守严格别名规则
- [ ] 遵守序列点规则

### 安全编码
- [ ] 不存在格式化字符串漏洞，绝不将用户输入直接用作格式串
- [ ] 分配大小已经校验，检查 count * size 的溢出
- [ ] 文件操作不存在 TOCTOU 竞态
- [ ] 使用外部输入前已经校验长度
- [ ] 临时文件使用 mkstemp 或等价机制

### API 与设计
- [ ] 所有权规则已记录且保持一致
- [ ] 对输入正确使用 const
- [ ] 错误处理约定清晰一致
- [ ] 已记录指针是否允许为空
- [ ] 使用不透明类型进行封装

### 可移植性
- [ ] 不存在未对齐的内存访问
- [ ] 传输格式或二进制格式显式处理字节序
- [ ] 二进制协议采用固定宽度类型
- [ ] 平台专用代码通过功能宏隔离

### 并发
- [ ] 共享状态不存在数据竞争
- [ ] 没有使用 volatile 代替同步
- [ ] 尽量缩短持锁时间
- [ ] 锁顺序一致

### 测试与工具
- [ ] 单元测试覆盖正常路径、错误路径和边界情况
- [ ] 开启警告选项（-Wall -Wextra -Werror）时构建无警告
- [ ] 关键代码路径使用 ASan、UBSan 等运行时检查工具
- [ ] 通过 Valgrind 或 ASan 确认没有内存泄漏
- [ ] 已处理静态分析结果
