# Zig 代码检视指南

> 重点关注显式内存所有权、错误联合类型、defer/errdefer 清理、comptime、带安全检查的操作、C 互操作和测试。

## 目录

- [内存与分配器](#内存与分配器)
- [错误与清理](#错误与清理)
- [指针、切片与可选值](#指针切片与可选值)
- [编译期执行与泛型](#编译期执行与泛型)
- [安全、未定义行为与类型转换](#安全未定义行为与类型转换)
- [C 互操作](#c-互操作)
- [测试](#测试)
- [风格与 API 设计](#风格与-api-设计)
- [检视清单](#检视清单)
- [参考资料](#参考资料)

---

## 内存与分配器

### 明确分配器所有权

Zig 代码应明确呈现分配策略。库通常应接受调用方传入的 std.mem.Allocator，而非在内部创建全局分配器。

```zig
const std = @import("std");

// ❌ 不佳：向调用方隐藏分配策略与生命周期。
fn readNamesBad() ![][]const u8 {
    var gpa = std.heap.DebugAllocator(.{}){};
    const allocator = gpa.allocator();
    return try allocator.alloc([]const u8, 10);
}

// ✅ 推荐：调用方选择分配器，并拥有返回的内存。
fn readNames(allocator: std.mem.Allocator) ![][]const u8 {
    return try allocator.alloc([]const u8, 10);
}
```

检视问题：
- 调用方是否知道谁拥有分配出的内存？
- API 是否说明返回的切片是否需要释放？
- 是否向下传递分配器参数，而非替换为内部全局分配器？

### 分配与清理配对

每条分配路径都应有明确清理路径。检查是否缺少 defer、errdefer，以及容器初始化后是否从未 deinit。

```zig
const std = @import("std");

fn collectBad(allocator: std.mem.Allocator) ![]u8 {
    // ❌ 不佳：返回的切片所依赖的内存在函数退出时已释放。
    var bad_list: std.ArrayListUnmanaged(u8) = .empty;
    defer bad_list.deinit(allocator);
    try bad_list.append(allocator, 'a');
    return bad_list.items;
}

fn collect(allocator: std.mem.Allocator) ![]u8 {
    // ✅ 推荐：`errdefer` 仅在失败时清理，成功时转移所有权。
    var list: std.ArrayListUnmanaged(u8) = .empty;
    errdefer list.deinit(allocator);

    try list.append(allocator, 'a');
    try list.append(allocator, 'b');
    return try list.toOwnedSlice(allocator);
}
```

检视问题：
- 获取资源后是否立即注册清理操作？
- 仅成功时转移所有权的情况，是否使用 errdefer？
- 所有容器初始化是否配套 deinit？

### 有意识地选择分配器

分配器选择属于设计的一部分。如果固定缓冲区、arena、页分配器或调用方提供的分配器更符合生命周期，应指出无差别使用调试或通用分配器的问题。

```zig
// ❌ 不佳：分配对象的生命周期分散在许多单独的释放操作中。
const user = try allocator.create(User);
const events = try allocator.alloc(Event, event_count);

// ✅ 推荐：请求或帧范围内的内存统一释放。
var arena = std.heap.ArenaAllocator.init(parent_allocator);
defer arena.deinit();
const allocator = arena.allocator();
```

检视问题：
- arena 分配是否在明确的生命周期边界释放？
- 测试是否使用 std.testing.allocator 检测泄漏？
- 库是否避免替调用方作出本应由调用方决定的策略选择？

---

## 错误与清理

### 让错误集合保留有效信息

除非边界确实需要，否则不要将有意义的错误全部泛化为 anyerror。具体错误集合可改善 API 契约，使调用方处理预期失败。

```zig
// ❌ 不佳：`anyerror` 掩盖了预期的解析错误。
fn parseDigitAny(input: []const u8) anyerror!u8 {
    if (input.len == 0) return error.EmptyInput;
    if (input[0] < '0' or input[0] > '9') return error.InvalidDigit;
    return input[0] - '0';
}

// ✅ 推荐：明确命名调用方应处理的领域错误。
const ParseError = error{
    EmptyInput,
    InvalidDigit,
};

fn parseDigit(input: []const u8) ParseError!u8 {
    if (input.len == 0) return error.EmptyInput;
    if (input[0] < '0' or input[0] > '9') return error.InvalidDigit;
    return input[0] - '0';
}
```

检视问题：
- 预期领域错误是否具有明确名称？
- anyerror 是否仅用于集成边界？
- 调用方转换错误时是否保留上下文？

### 有目的地使用 try、catch 和 errdefer

除非不变量可以由机制保证，否则盲目 catch unreachable 值得警惕。优先用 try 传播错误、在边界转换，或通过注释解释不可达状态的依据。

```zig
// ❌ 不佳：掩盖真实的分配失败。
const buffer_bad = allocator.alloc(u8, size) catch unreachable;

// ✅ 推荐：调用方可以处理 OutOfMemory。
const buffer = try allocator.alloc(u8, size);
```

检视问题：
- catch unreachable 是否掩盖 I/O、内存分配、解析或用户输入错误？
- 错误是否在抽象发生变化的边界附近转换？
- 失败时 errdefer 是否撤销部分状态修改？

---

## 指针、切片与可选值

### 优先使用切片，而非分别传指针和长度

切片将指针和长度放在一起，有利于边界检查和 API 清晰性。原始指针加长度主要留给 FFI 或底层代码。

```zig
// ❌ 不佳：指针与长度容易不匹配。
fn checksumRaw(ptr: [*]const u8, len: usize) u32 {
    var sum: u32 = 0;
    for (ptr[0..len]) |byte| sum += byte;
    return sum;
}

// ✅ 推荐：用一个值表示缓冲区。
fn checksum(bytes: []const u8) u32 {
    var sum: u32 = 0;
    for (bytes) |byte| sum += byte;
    return sum;
}
```

检视问题：
- 原始指针 API 能否改为切片 API？
- 是否使用 ?T 表达可空性，而非哨兵值？
- 函数返回后指针生命周期是否清晰？

### 避免返回栈数据指针

仔细检视返回的切片和指针。Zig 使许多生命周期问题更明显，但仍需确认返回数据的生命周期长于函数调用。

```zig
// ❌ 不佳：返回的切片指向栈内存。
fn labelStack() []const u8 {
    var buf: [16]u8 = undefined;
    _ = &buf;
    return buf[0..];
}

// ✅ 推荐：调用方拥有分配结果，并可释放它。
fn label(allocator: std.mem.Allocator) ![]u8 {
    return try allocator.dupe(u8, "ready");
}
```

检视问题：
- 返回的内存是否来自调用方、分配器、静态存储或稳定的所有者？
- 底层缓冲区修改或释放后，切片是否仍逃逸到外部？
- 可变切片的别名关系是否有意设计并已记录？

---

## 编译期执行与泛型

### 控制 comptime 工作量并保持可读

comptime 很强大，但复杂的编译期逻辑可能恶化报错可读性和构建时间。优先使用具有清晰类型契约的小型泛型辅助函数。

```zig
fn RingBuffer(comptime T: type, comptime capacity: usize) type {
    // ✅ 推荐：无效泛型参数产生可指导修复的错误信息。
    if (capacity == 0) @compileError("capacity must be greater than zero");

    return struct {
        items: [capacity]T = undefined,
        len: usize = 0,
    };
}
```

检视问题：
- comptime 是否约束真实的不变量？
- 编译错误是否明确且可操作？
- 反射代码是否与普通运行时逻辑隔离？

### 避免过于宽泛的 anytype

anytype 提高灵活性，也可能隐藏所需能力。可以时增加 comptime 检查，或采用明确接口。

```zig
// ✅ 推荐：调用处清楚展示 writer 必须提供的能力。
fn writeAll(writer: anytype, bytes: []const u8) !void {
    try writer.writeAll(bytes);
}
```

检视问题：
- 函数体或文档是否说明 anytype 所需的数据形状？
- 使用具体类型或更小的辅助函数是否更易检视？
- 传入错误类型时，编译错误是否易于理解？

---

## 安全、未定义行为与类型转换

### 重点检视 undefined、unreachable 和强制转换

Zig 直接暴露底层控制。逐一检视 undefined、unreachable、@ptrCast、@alignCast、@intCast，以及指针与整数之间的转换。

```zig
// ❌ 不佳：未经验证就假设数据布局、字节序、长度和对齐方式。
const header: *const Header = @ptrCast(@alignCast(bytes.ptr));

// ✅ 推荐：显式解析字段，读取前检查长度。
if (bytes.len < 4) return error.ShortInput;
const magic = std.mem.readInt(u16, bytes[0..2], .little);
const flags = std.mem.readInt(u16, bytes[2..4], .little);
```

检视问题：
- undefined 是否在读取前已被实际值覆盖？
- unreachable 是否仅用于不可能状态，依据不明显时是否就近解释？
- 转换前是否检查布局、范围、对齐、大小、字节序和可空性？

### 默认使用带检查的算术，仅在有意设计时回绕

+% 和 -% 等回绕运算符很有用，但应代表明确的模运算选择。

```zig
// ❌ 不佳：回绕运算掩盖了本应暴露逻辑缺陷的溢出。
index = index +% 1;

// ✅ 推荐：受检查的算术运算在意外溢出时触发错误。
sum += byte;

// ✅ 推荐：模运算哈希明确需要回绕行为。
hash = hash *% 16777619;
hash = hash +% byte;
```

检视问题：
- 算法是否确实需要回绕运算？
- 溢出是否意味着输入非法或存在缺陷？
- 整数位宽转换是否显式，并在边界附近测试？

---

## C 互操作

### 封装 C 边界

将 @cImport、C 指针处理和 ABI 假设集中在包装层附近。C 数据进入代码仓其他部分前，先转换为 Zig 类型。

```zig
const std = @import("std");

// ❌ 不佳：无需跨 C 边界，却使用 C 的 strlen。
fn strlenC(input: [*:0]const u8) usize {
    const c = @cImport({
        @cInclude("string.h");
    });

    return c.strlen(input);
}

// ✅ 推荐：使用 Zig 标准库中支持哨兵的辅助函数。
fn strlenZ(input: [*:0]const u8) usize {
    return std.mem.len(input);
}
```

检视问题：
- C 指针是否用正确的 Zig 指针类型表达？
- 哨兵结尾字符串是否用哨兵指针或切片建模？
- 是否记录 C 库的所有权和清理规则？
- 是否在边界附近将 C 错误码转换为 Zig 错误联合类型？

---

## 测试

### 使用 std.testing 断言与泄漏检测

涉及内存分配的测试应尽量使用 std.testing.allocator，让测试运行器报告泄漏。

```zig
const std = @import("std");

test "collect returns owned memory on success" {
    const allocator = std.testing.allocator;
    const names = try collect(allocator);
    defer allocator.free(names);

    try std.testing.expectEqual(@as(usize, 2), names.len);
}

test "collect handles allocation failures cleanly" {
    var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{
        .fail_index = 0,
    });
    try std.testing.expectError(error.OutOfMemory, collect(failing.allocator()));
}
```

检视问题：
- 内存分配密集路径是否有测试？
- 错误路径是否使用 std.testing.expectError 测试？
- 是否覆盖空输入、单元素、最大容量和非法编码等边界？

### 需要时测试不同构建模式与目标平台

行为可能随安全模式、目标平台和 ABI 改变。底层代码检视需确认是否在预期目标和优化模式下测试。

检视问题：
- 代码是否依赖仅调试模式启用的安全检查？
- packed、对齐及 extern 布局代码是否有针对目标平台的测试？
- 字节序、指针宽度和 ABI 假设是否经测试或文档明确？

---

## 风格与 API 设计

### 遵循 Zig 命名约定

以官方风格指南为基础：类型用 TitleCase，函数用 camelCase，变量用 snake_case。若外围命名空间已表达含义，避免重复添加 Value、Data、Manager 或 State 等词。

```zig
// ❌ 不佳：命名空间冗余，类型名称模糊。
pub const json_bad = struct {
    pub const JsonValueManager = struct {};
};

// ✅ 推荐：结合完整命名空间后，名称含义清晰。
pub const json = struct {
    pub const Value = union(enum) {};
};
```

检视问题：
- 完全限定名称读起来是否自然？
- 文件和目录名是否符合风格指南？
- 除非来自外部约定，是否避免以下划线开头的声明？
- 公共 API 是否在有帮助的地方提供文档注释？

### 保持公共 API 精简

Zig 模块常直接从文件和结构体暴露声明。检查 pub 声明是否存在意外导出。

检视问题：
- 此声明确实需要 pub 吗？
- 公共 API 是否足够稳定，适合暴露？
- 是否通过更小的接口隐藏实现细节？

---

## 检视清单

### 内存与生命周期
- [ ] 分配器所有权明确。
- [ ] 分配配套 free、deinit、defer 或 errdefer。
- [ ] 返回的切片和指针所指数据生命周期长于函数调用。
- [ ] arena 或临时分配有明确生命周期边界。

### 错误与清理
- [ ] 可以时用具体错误集合表示预期失败。
- [ ] catch unreachable 不掩盖真实运行时失败。
- [ ] 部分初始化失败通过 errdefer 回滚。
- [ ] 错误在抽象边界转换。

### 指针与安全
- [ ] 原始指针使用有依据，普通缓冲区使用切片。
- [ ] 转换时检查大小、范围、对齐和可空性。
- [ ] 初始化前不读取 undefined。
- [ ] 回绕运算经过明确设计和测试。

### 编译期执行与 API 设计
- [ ] comptime 逻辑约束有价值的不变量。
- [ ] anytype 的使用要求清晰。
- [ ] 公共声明均为有意暴露。
- [ ] 命名遵循 Zig 风格约定。

### C 互操作与可移植性
- [ ] C 边界由包装层隔离。
- [ ] 已记录 C 所有权和清理规则。
- [ ] 目标平台、字节序、指针宽度和 ABI 假设经过测试或文档说明。

### 测试
- [ ] 内存分配密集代码使用 std.testing.allocator 测试。
- [ ] 错误路径使用 std.testing.expectError。
- [ ] 覆盖边界情况。
- [ ] 考虑相关构建模式与目标平台。

---

## 参考资料

- [Zig 0.16.0 语言参考](https://ziglang.org/documentation/0.16.0/)
- [Zig 0.16.0 标准库文档](https://ziglang.org/documentation/0.16.0/std/)
- [Zig 0.16.0 风格指南](https://ziglang.org/documentation/0.16.0/#Style-Guide)
- [选择分配器](https://ziglang.org/documentation/0.16.0/#Choosing-an-Allocator)
