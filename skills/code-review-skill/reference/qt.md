# Qt 代码检视指南

> 重点关注对象模型、信号与槽、Model/View、QML、Qt 6 迁移、事件循环、测试和 GUI 性能。示例基于 Qt 5.15 / Qt 6。

## 目录

- [对象模型与内存管理](#对象模型与内存管理)
- [信号与槽](#信号与槽)
- [容器与字符串](#容器与字符串)
- [线程与并发](#线程与并发)
- [GUI 与控件](#gui-与控件)
- [Model/View 架构](#modelview-架构)
- [元对象系统](#元对象系统)
- [QML / Qt Quick](#qml--qt-quick)
- [Qt 5 → Qt 6 迁移](#qt-5--qt-6-迁移)
- [测试](#测试)
- [检视清单](#检视清单)

---

## 对象模型与内存管理

### 使用父子对象所有权机制
Qt 的 `QObject` 层次结构会自动管理内存。对于 `QObject`，优先设置父对象，避免手动 `delete` 或智能指针管理。

```cpp
// ❌ 手动管理容易导致内存泄漏
QWidget* w = new QWidget();
QLabel* l = new QLabel();
l->setParent(w);
// ……删除 w 时 l 会自动删除，但 w 泄漏时 l 也会泄漏。

// ✅ 在构造函数中指定父对象
QWidget* w = new QWidget(this); // 由 'this' 拥有
QLabel* l = new QLabel(w);      // 由 'w' 拥有
```

### 为 QObject 使用智能指针
`QObject` 没有父对象时，可使用 `QScopedPointer`，或带自定义删除器的 `std::unique_ptr`；跨线程时使用 `deleteLater`。非必要时避免 `std::shared_ptr`，以免混淆父子对象所有权。

```cpp
// ✅ 无父对象的局部或成员 QObject 使用作用域智能指针
QScopedPointer<MyObject> obj(new MyObject());

// ✅ 使用安全指针防止悬空指针
QPointer<MyObject> safePtr = obj.data();
if (safePtr) {
    safePtr->doSomething();
}
```

### 使用 deleteLater()
异步删除时，尤其在槽或事件处理器中，使用 `deleteLater()` 而非 `delete`，以便事件循环处理待处理事件。

```cpp
// ❌ 不佳：在槽中 delete，可能使正在发送信号的发送者失效
void MyWidget::onFinished() {
    delete this;  // 未定义行为：可能在信号调用链内执行
}

// ✅ 推荐：安全地延迟删除
void MyWidget::onFinished() {
    deleteLater();
}
```

### 避免双重所有权

```cpp
// ❌ 不佳：父对象拥有对话框，同时又用 unique_ptr 管理它
auto dialog = std::make_unique<QDialog>(this);  // 父对象为 'this'，同时 unique_ptr 也拥有它

// ✅ 推荐：由父对象管理所有权，通过裸指针访问
auto* dialog = new QDialog(this);
```

---

## 信号与槽

### 优先使用函数指针语法
使用支持编译期检查的语法（Qt 5+）。

```cpp
// ❌ 基于字符串的连接，仅运行时检查且更慢
connect(sender, SIGNAL(valueChanged(int)), receiver, SLOT(updateValue(int)));

// ✅ 编译期检查
connect(sender, &Sender::valueChanged, receiver, &Receiver::updateValue);
```

### Lambda 连接应指定上下文对象

```cpp
// ❌ 不佳：lambda 捕获裸 `this`，对象删除后会崩溃
connect(timer, &QTimer::timeout, [this]() {
    update();  // 'this' 已销毁时会崩溃
});

// ✅ 推荐：上下文对象销毁时自动断开连接
connect(timer, &QTimer::timeout, this, [this]() {
    update();
});
```

### 连接类型
跨线程时显式指定或明确了解连接类型。
- `Qt::AutoConnection`（默认）：同线程直接调用，跨线程排队调用。
- `Qt::QueuedConnection`：始终投递事件，适合跨线程安全传递。
- `Qt::DirectConnection`：立即调用；跨线程访问非线程安全数据时有风险。

### 避免信号循环
检查可能形成无限循环的逻辑，例如 `valueChanged` → `setValue` → `valueChanged`。设置值之前阻断信号或检查值是否相等。

```cpp
void MyClass::setValue(int v) {
    if (m_value == v) return; // ✅ 推荐：打断循环
    m_value = v;
    emit valueChanged(v);
}
```

### 适时断开连接

```cpp
// ✅ 推荐：切换目标前显式断开连接
disconnect(oldSource, &Source::data, this, &Receiver::onData);
connect(newSource, &Source::data, this, &Receiver::onData);
```

---

## 容器与字符串

### QString 使用效率
- 使用 `QStringLiteral("...")` 在编译期创建字符串，避免运行时分配。
- Qt 5 中，与 ASCII 字面量比较时使用 `QLatin1String`。
- 格式化优先使用 `arg()`，或 `QStringBuilder` 的 `%` 运算符。

```cpp
// ❌ 运行时转换
if (str == "test") ...

// ✅ Qt 5 中与 ASCII 字面量比较时，优先使用 QLatin1String
if (str == QLatin1String("test")) ... // Qt 5
if (str == u"test"_s) ...             // Qt 6
```

### 容器选择
- **Qt 6**：`QList` 已与 `QVector` 统一，成为默认选择。
- **Qt 5**：除非需要稳定引用，否则优先使用 `QVector`，以获得连续内存和较好的缓存性能。
- 留意隐式共享，即写时复制。按值传递容器在修改之前成本较低；只读访问使用 `const &`。

```cpp
// ❌ 函数修改 'list' 时会强制深复制
void process(QVector<int> list) {
    list[0] = 1;
}

// ✅ 只读引用
void process(const QVector<int>& list) { ... }
```

### 只读遍历使用 constBegin/constEnd

```cpp
// ❌ 不佳：begin()/end() 可能触发分离
for (auto it = list.begin(); it != list.end(); ++it) {
    qDebug() << *it;
}

// ✅ 推荐：const 迭代避免分离
for (auto it = list.constBegin(); it != list.constEnd(); ++it) {
    qDebug() << *it;
}

// ✅ 更好：使用 const 引用的范围 for 循环（Qt 5.7+）
for (const auto& item : list) {
    qDebug() << item;
}
```

---

## 线程与并发

### QThread 子类与工作对象模式
优先使用工作对象模式，避免通过继承 `QThread` 实现工作逻辑。

```cpp
// ❌ 在 QThread::run() 中放入业务逻辑
class MyThread : public QThread {
    void run() override { ... }
};

// ✅ 将工作对象移动到线程
QThread* thread = new QThread;
Worker* worker = new Worker;
worker->moveToThread(thread);
connect(thread, &QThread::started, worker, &Worker::process);
connect(thread, &QThread::finished, worker, &QObject::deleteLater);
thread->start();
```

### GUI 线程安全
**绝不**在后台线程访问 `QWidget` 及其子类。通过信号和槽将更新传给主线程。

```cpp
// ❌ 不佳：从工作线程访问组件
void Worker::onResult(Data data) {
    label->setText(data.toString());  // 崩溃：不在 GUI 线程
}

// ✅ 推荐：通过信号通知 GUI 线程
void Worker::onResult(Data data) {
    emit resultReady(data);  // 通过 QueuedConnection 连接
}
// 在主线程中：
connect(worker, &Worker::resultReady, this, [this](const Data& d) {
    label->setText(d.toString());
});
```

### 简单并行任务使用 QtConcurrent

```cpp
// ✅ 推荐：简单的并行计算
auto future = QtConcurrent::run([data]() {
    return heavyComputation(data);
});

// ✅ 推荐：映射归约模式
auto results = QtConcurrent::mappedReduced(
    inputList,
    [](const Item& item) { return process(item); },
    [](int& result, int value) { result += value; }
);
```

---

## GUI 与控件

### 分离逻辑
不要把业务逻辑放进 `MainWindow`、`Dialog` 等 UI 类。UI 类只负责展示和转发用户输入。

### 布局
避免固定尺寸（`setGeometry`、`resize`）。使用 `QVBoxLayout`、`QGridLayout` 等布局，适应不同 DPI 和窗口大小变化。

### 避免阻塞事件循环
不要在主线程执行长时间操作，否则 GUI 会卡死。
- **不佳**：`Sleep()`、`while(busy)`、同步网络调用。
- **更好**：`QProcess`、`QThread`、`QtConcurrent` 或 `QNetworkAccessManager` 等异步 API。

### 高 DPI 缩放

```cpp
// ✅ Qt 5：启用高 DPI 缩放
QGuiApplication::setAttribute(Qt::AA_EnableHighDpiScaling);

// ✅ Qt 6：默认启用，但需确认图标和自定义绘制正确缩放
```

---

## Model/View 架构

### 正确继承 QAbstractItemModel

实现自定义模型时，**必须**实现以下方法：

```cpp
class TaskModel : public QAbstractTableModel {
    Q_OBJECT
public:
    int rowCount(const QModelIndex& parent = {}) const override {
        if (parent.isValid()) return 0;  // 表格模型没有树形层级
        return m_tasks.size();
    }

    int columnCount(const QModelIndex& parent = {}) const override {
        if (parent.isValid()) return 0;
        return 3;  // title, priority, status
    }

    QVariant data(const QModelIndex& index, int role) const override {
        if (!index.isValid() || index.row() >= m_tasks.size())
            return {};

        if (role == Qt::DisplayRole) {
            switch (index.column()) {
                case 0: return m_tasks[index.row()].title;
                case 1: return m_tasks[index.row()].priority;
                case 2: return m_tasks[index.row()].status;
            }
        }
        return {};
    }

    // 表头所需
    QVariant headerData(int section, Qt::Orientation orientation, int role) const override {
        if (role != Qt::DisplayRole) return {};
        if (orientation == Qt::Horizontal) {
            switch (section) {
                case 0: return "Title";
                case 1: return "Priority";
                case 2: return "Status";
            }
        }
        return section + 1;  // 行号
    }

private:
    QVector<Task> m_tasks;
};
```

### 将变更通知视图

```cpp
// ❌ 不佳：修改数据后未通知视图
void TaskModel::addTask(const Task& task) {
    m_tasks.append(task);  // 视图不知道数据已变化
}

// ✅ 推荐：发送正确的信号
void TaskModel::addTask(const Task& task) {
    beginInsertRows({}, m_tasks.size(), m_tasks.size());
    m_tasks.append(task);
    endInsertRows();
}

void TaskModel::updateStatus(int row, const QString& status) {
    m_tasks[row].status = status;
    emit dataChanged(index(row, 2), index(row, 2), {Qt::DisplayRole});
}

void TaskModel::clearAll() {
    beginResetModel();
    m_tasks.clear();
    endResetModel();
}
```

### 使用委托模式自定义渲染

```cpp
class PriorityDelegate : public QStyledItemDelegate {
    Q_OBJECT
public:
    void paint(QPainter* painter, const QStyleOptionViewItem& option,
               const QModelIndex& index) const override {
        QStyleOptionViewItem opt = option;
        initStyleOption(&opt, index);

        // 按优先级使用不同颜色
        QString priority = index.data().toString();
        if (priority == "High") {
            opt.backgroundBrush = QColor("#ffcccc");
        } else if (priority == "Low") {
            opt.backgroundBrush = QColor("#ccffcc");
        }

        QStyledItemDelegate::paint(painter, opt, index);
    }
};

// Usage:
tableView->setItemDelegateForColumn(1, new PriorityDelegate(this));
```

### 大数据集性能

- 使用 `beginInsertRows`/`endInsertRows` 批量插入，不要逐行插入。
- 超过 10 万行时，可考虑用 `QSortFilterProxyModel` 筛选，而非重新查询。
- 使用 `model()->fetchMore()` 实现惰性加载或分页。
- 避免通过 `Qt::UserRole + N` 携带重型对象；改用轻量键，并在外部查找对象。

---

## 元对象系统

### 属性与枚举
对于暴露给 QML 或需要自省的值，使用 `Q_PROPERTY`。
使用 `Q_ENUM` 支持枚举与字符串转换。

```cpp
class MyObject : public QObject {
    Q_OBJECT
    Q_PROPERTY(int value READ value WRITE setValue NOTIFY valueChanged)
public:
    enum State { Idle, Running };
    Q_ENUM(State)
    // ...
};
```

### qobject_cast
对 QObject 使用 `qobject_cast<T*>`，而非 `dynamic_cast`，前者更快且不要求 RTTI。

### 值类型使用 Q_GADGET

```cpp
// ✅ 推荐：在不承担 QObject 开销的情况下支持内省
struct Coordinate {
    Q_GADGET
    Q_PROPERTY(double x MEMBER x)
    Q_PROPERTY(double y MEMBER y)
public:
    double x = 0.0;
    double y = 0.0;
};
Q_DECLARE_METATYPE(Coordinate)
```

---

## QML / Qt Quick

### C++/QML 边界设计

```cpp
// ✅ 推荐：通过上下文属性（Qt 5）或 QML_SINGLETON（Qt 6）向 QML 暴露 C++ 模型

// Qt 6: QML_ELEMENT + QML_SINGLETON
class AppSettings : public QObject {
    Q_OBJECT
    QML_ELEMENT
    QML_SINGLETON
    Q_PROPERTY(QString theme READ theme WRITE setTheme NOTIFY themeChanged)
public:
    QString theme() const { return m_theme; }
    void setTheme(const QString& t) {
        if (m_theme != t) {
            m_theme = t;
            emit themeChanged();
        }
    }
signals:
    void themeChanged();
private:
    QString m_theme;
};
```

### QML 性能最佳实践

```qml
// ❌ 不佳：onCompleted 中的 JavaScript 阻塞 UI 线程
Component.onCompleted: {
    for (var i = 0; i < 10000; i++) {
        model.append({"value": i});  // 速度慢，阻塞渲染
    }
}

// ✅ 推荐：使用 C++ 模型，或用 WorkerScript 处理耗时 JavaScript
// 大型数据集优先使用 C++ QAbstractListModel
```

```qml
// ❌ 不佳：频繁的属性绑定导致重复求值
Rectangle {
    width: parent.width * 0.8 + someComplexCalc()
    height: parent.height * 0.6 + anotherCalc()
}

// ✅ 推荐：降低绑定复杂度
Rectangle {
    width: parent.width * 0.8
    height: parent.height * 0.6
}
```

### QML 对象生命周期

- 由 QML 创建的对象归 QML 引擎所有。
- `Qt.createComponent()` 配合 `createObject()` 创建的对象，由调用方管理生命周期。
- 重型组件使用 `Loader` 惰性实例化。
- `property var myObj: QtObject {}` 中的对象由 QML 引擎持有。

```qml
// ✅ 推荐：用 Loader 按条件加载复杂 UI
Loader {
    id: detailLoader
    active: selectedItem !== null
    sourceComponent: active ? detailComponent : null
}
```

---

## Qt 5 → Qt 6 迁移

### 关键不兼容变更

| Qt 5 | Qt 6 | 说明 |
|------|------|-------|
| `QList` ≠ `QVector` | `QList` = `QVector` | 已统一，QList 内部采用 QVector |
| `QStringRef` | `QStringView` | QStringView 不拥有数据，更接近 string_view |
| `QLatin1String` | `QLatin1StringView` | 也可使用 `u"..."_s` 字符串字面量 |
| `QTextStream(stream)` | `QTextStream(&string)` | 构造函数变化 |
| `QMouseEvent::pos()` | `QMouseEvent::position()` | 返回 QPointF，而非 QPoint |
| `QWheelEvent::delta()` | `QWheelEvent::angleDelta()` | Qt 5 中已弃用 |
| `QComboBox::activated(int)` | `QComboBox::textActivated(QString)` | 消除重载歧义 |

### 用 CMake 替换 qmake

```cmake
# ✅ Qt 6 CMakeLists.txt
cmake_minimum_required(VERSION 3.16)
project(MyApp LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
set(CMAKE_AUTORCC ON)

find_package(Qt6 REQUIRED COMPONENTS Widgets Quick Core)

qt_add_executable(MyApp
    main.cpp
    MainWindow.cpp
    MainWindow.h
    resources.qrc
)

target_link_libraries(MyApp PRIVATE
    Qt6::Widgets
    Qt6::Quick
    Qt6::Core
)
```

### Qt 6 新 API 与改进

```cpp
// ✅ Qt 6：使用 QStringView 替代 QStringRef
void process(QStringView sv);  // non-owning, efficient

// ✅ Qt 6：通过 QCalendar API 处理日期
QCalendar cal(QCalendar::System::Gregorian);
QDate date = cal.dateFromParts(2024, 3, 15);

// ✅ Qt 6：Qt Concurrent 的改进
auto future = QtConcurrent::run(QThreadPool::globalInstance(),
                                 []() { return heavyWork(); });

// ✅ Qt 6：容器的比较 API
QList<int> a = {1, 2, 3};
QList<int> b = {1, 2, 3};
bool eq = a == b;  // 在 Qt 6 中正确运行
```

### 迁移清单

- [ ] 用 `CMake` 替换 `qmake`，或使用 `qt-cmake`
- [ ] 用 `QStringView` 替换 `QStringRef`
- [ ] 替换已弃用的事件访问器，例如 `pos()` → `position()`
- [ ] 更新重载信号的信号槽连接，使用 `qOverload`
- [ ] 验证 `QList`/`QVector` 的可互换性
- [ ] 使用 Qt 6 兼容模块测试：`find_package(Qt6 COMPONENTS Core5Compat)`

---

## 测试

### QTest 框架

```cpp
#include <QtTest>
#include "parser.h"

class TestParser : public QObject {
    Q_OBJECT
private slots:
    void testEmptyInput() {
        Parser p("");
        QVERIFY(p.nextToken().isNull());
    }

    void testIntegerToken() {
        Parser p("42");
        auto token = p.nextToken();
        QCOMPARE(token.type(), Token::Integer);
        QCOMPARE(token.value().toInt(), 42);
    }

    void testNegativeNumber() {
        Parser p("-7");
        auto token = p.nextToken();
        QCOMPARE(token.value().toInt(), -7);
    }

    // 数据驱动测试
    void testValidTokens_data() {
        QTest::addColumn<QString>("input");
        QTest::addColumn<int>("expectedType");

        QTest::newRow("integer") << "42" << static_cast<int>(Token::Integer);
        QTest::newRow("string") << "\"hello\"" << static_cast<int>(Token::String);
        QTest::newRow("operator") << "+" << static_cast<int>(Token::Operator);
    }

    void testValidTokens() {
        QFETCH(QString, input);
        QFETCH(int, expectedType);

        Parser p(input);
        auto token = p.nextToken();
        QCOMPARE(token.type(), static_cast<Token::Type>(expectedType));
    }
};

QTEST_MAIN(TestParser)
#include "test_parser.moc"
```

### 使用 QTest 测试 GUI

```cpp
class TestLoginDialog : public QObject {
    Q_OBJECT
private slots:
    void testLoginButtonDisabledWhenEmpty() {
        LoginDialog dialog;
        dialog.show();
        QVERIFY(QTest::qWaitForWindowExposed(&dialog));

        // 初始状态下，登录按钮应禁用
        QPushButton* loginBtn = dialog.findChild<QPushButton*>("loginButton");
        QVERIFY(loginBtn != nullptr);
        QVERIFY(!loginBtn->isEnabled());
    }

    void testLoginEnabledAfterInput() {
        LoginDialog dialog;
        dialog.show();
        QVERIFY(QTest::qWaitForWindowExposed(&dialog));

        QLineEdit* userField = dialog.findChild<QLineEdit*>("usernameField");
        QLineEdit* passField = dialog.findChild<QLineEdit*>("passwordField");

        QTest::keyClicks(userField, "alice");
        QTest::keyClicks(passField, "secret123");

        QPushButton* loginBtn = dialog.findChild<QPushButton*>("loginButton");
        QVERIFY(loginBtn->isEnabled());
    }

    void testSubmitOnEnter() {
        LoginDialog dialog;
        dialog.show();
        QVERIFY(QTest::qWaitForWindowExposed(&dialog));

        QLineEdit* userField = dialog.findChild<QLineEdit*>("usernameField");
        QTest::keyClicks(userField, "alice");
        QTest::keyClick(userField, Qt::Key_Return);

        // 确认对话框发送了 accepted 信号
        QTRY_COMPARE(dialog.result(), static_cast<int>(QDialog::Accepted));
    }
};
```

### 为单元测试模拟 Qt 对象

```cpp
// ✅ 推荐：注入依赖以便测试
class NetworkService {
public:
    virtual ~NetworkService() = default;
    virtual QJsonObject fetchUser(int id) = 0;
};

class MockNetworkService : public NetworkService {
public:
    QJsonObject fetchUser(int id) override {
        return m_responses.value(id, {});
    }
    void setResponse(int id, const QJsonObject& json) {
        m_responses[id] = json;
    }
private:
    QHash<int, QJsonObject> m_responses;
};

// 测试中：
void testProfileDisplay() {
    MockNetworkService mock;
    mock.setResponse(1, {{"name", "Alice"}, {"role", "admin"}});

    ProfileController controller(&mock);
    controller.loadProfile(1);
    QCOMPARE(controller.name(), "Alice");
    QCOMPARE(controller.role(), "admin");
}
```

### CI 集成

```bash
# Qt 6 测试运行器
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Debug -DBUILD_TESTING=ON
cmake --build .
ctest --output-on-failure

# 在无显示设备的 CI 中，使用 Xvfb 运行 GUI 测试
xvfb-run -a ctest --output-on-failure
```

---

## 检视清单

### 内存
- [ ] 父子关系是否正确，是否通过 `QPointer` 避免悬空指针？
- [ ] 不存在父对象与智能指针同时持有的双重所有权
- [ ] 槽中使用 `deleteLater()`，而非 `delete`

### 信号与槽
- [ ] 使用具有编译期检查的函数指针语法
- [ ] Lambda 连接具有上下文对象，以支持自动断开
- [ ] 没有信号循环，通过相等性检查或 blockSignals 防护
- [ ] 更换信号源时正确断开旧连接

### 线程
- [ ] 是否仅从主线程访问 UI？
- [ ] 长任务是否转交 QThread 工作对象或 QtConcurrent？
- [ ] 优先使用工作对象模式，而非继承 QThread
- [ ] 删除前先退出线程并等待结束，确保正确清理

### 字符串与容器
- [ ] 编译期字符串使用 `QStringLiteral` 或 `u"..."_s`
- [ ] 只读容器访问使用 `const &`
- [ ] 循环中没有隐式分离，使用 const 迭代器或 const 引用范围循环

### Model/View
- [ ] 正确发送插入、移除和重置操作的 begin/end 通知
- [ ] 单项更新时发送 dataChanged
- [ ] 自定义渲染使用委托，而非继承视图

### QML
- [ ] C++/QML 边界使用 QML_ELEMENT（Qt 6）或注册类型
- [ ] 繁重计算不放在 QML JavaScript 中
- [ ] 条件或惰性实例化组件时使用 Loader

### 测试
- [ ] 核心逻辑具备 QTest 单元测试
- [ ] GUI 测试使用 QTest::keyClicks / qWaitForWindowExposed
- [ ] 通过依赖注入支持模拟
- [ ] 测试在 CI 中运行，GUI 测试配合 Xvfb

### 风格
- [ ] 遵循命名约定，方法使用 camelCase，类使用 PascalCase
- [ ] 从 `.qrc` 加载资源
- [ ] 所有 QObject 子类包含 `Q_OBJECT` 宏
