# SQL 注入防护指南

语言无关的 SQL 注入防护策略，附跨语言代码示例。

> **相关资料：** 完整安全检查清单与决策框架见[安全检视指南](../security-review-guide.md)。

## 攻击类型

SQL 注入（SQLi）属于 OWASP Top 10（2021）中排名第三的注入类别。常见变体有三种：

| 类型 | 描述 | 风险 |
|------|-------------|------|
| **经典型（带内）** | 攻击者直接从 HTTP 响应获得结果 | 数据外泄、绕过认证 |
| **盲注（布尔或时间型）** | 根据响应差异或时间推断数据 | 速度较慢，但仍可提取数据 |
| **带外型** | 通过 DNS/HTTP 回调向外传输数据 | 较少见，但更难检测 |

## 通用防护策略

1. **参数化查询**：始终使用，这是首要防线。
2. **安全使用 ORM**：了解 ORM 实际转义哪些内容。
3. **输入校验**：优先白名单，而非黑名单。
4. **最小权限**：数据库账号仅授予必要权限。
5. **WAF**：以 Web 应用防火墙补充纵深防御。

---

## 跨语言示例

### Python

```python
# ❌ 存在漏洞：字符串格式化
query = f"SELECT * FROM users WHERE id = {user_id}"
cursor.execute(query)

# ❌ Vulnerable: % formatting
cursor.execute("SELECT * FROM users WHERE id = %s" % user_id)

# ✅ Parameterized (DB-API)
cursor.execute("SELECT * FROM users WHERE id = %s", (user_id,))

# ✅ SQLAlchemy ORM
User.query.filter(User.id == user_id).all()

# ❌ SQLAlchemy 原生 SQL 使用字符串插值
session.execute(text(f"SELECT * FROM users WHERE id = {user_id}"))

# ✅ SQLAlchemy 原生 SQL 使用参数绑定
session.execute(text("SELECT * FROM users WHERE id = :id"), {"id": user_id})

# ✅ Django ORM
User.objects.filter(id=user_id)

# ❌ Django extra() 使用字符串插值
User.objects.extra(where=[f"username = '{username}'"])

# ✅ Django raw() 使用参数
User.objects.raw("SELECT * FROM users WHERE id = %s", [user_id])
```

### Java

```java
// ❌ 存在漏洞：字符串拼接
String query = "SELECT * FROM users WHERE id = " + userId;
Statement stmt = connection.createStatement();
ResultSet rs = stmt.executeQuery(query);

// ✅ JDBC PreparedStatement
String query = "SELECT * FROM users WHERE id = ?";
PreparedStatement stmt = connection.prepareStatement(query);
stmt.setLong(1, userId);
ResultSet rs = stmt.executeQuery();

// ✅ JPA 参数绑定
@Query("SELECT u FROM User u WHERE u.id = :id")
User findById(@Param("id") Long id);

// ✅ Spring Data JPA 方法命名
User findById(Long id);

// ❌ JPA 原生查询使用字符串拼接
entityManager.createNativeQuery(
    "SELECT * FROM users WHERE name = '" + name + "'"
);

// ✅ JPA 原生查询使用参数绑定
Query query = entityManager.createNativeQuery(
    "SELECT * FROM users WHERE name = :name"
);
query.setParameter("name", name);
```

### Go

```go
// ❌ Vulnerable: fmt.Sprintf
query := fmt.Sprintf("SELECT * FROM users WHERE id = %s", userID)
rows, err := db.Query(query)

// ✅ database/sql 参数化查询
rows, err := db.Query("SELECT * FROM users WHERE id = ?", userID)

// ✅ 命名参数（sqlx）
rows, err := db.NamedQuery(
    "SELECT * FROM users WHERE id = :id",
    map[string]interface{}{"id": userID},
)

// ⚠️ 动态标识符（表名、列名）不能使用占位符
// 必须根据允许列表进行校验
var allowedColumns = map[string]bool{
    "id": true, "name": true, "email": true, "created_at": true,
}

func queryWithOrder(db *sql.DB, orderBy string) (*sql.Rows, error) {
    if !allowedColumns[orderBy] {
        return nil, fmt.Errorf("invalid column: %s", orderBy)
    }
    return db.Query(
        fmt.Sprintf("SELECT * FROM users ORDER BY %s", orderBy),
    )
}
```

### Node.js

```typescript
// ❌ 存在漏洞：模板字面量
const query = `SELECT * FROM users WHERE id = ${userId}`;
const result = await client.query(query);

// ✅ pg 参数化查询（$1、$2 等）
const result = await client.query(
    "SELECT * FROM users WHERE id = $1",
    [userId]
);

// ✅ Prisma ORM（默认参数化）
const user = await prisma.user.findUnique({
    where: { id: userId },
});

// ❌ Prisma $queryRawUnsafe 使用字符串插值
await prisma.$queryRawUnsafe(
    `SELECT * FROM users WHERE id = ${userId}`
);

// ✅ Prisma $queryRaw 使用标签模板（安全）
await prisma.$queryRaw`
    SELECT * FROM users WHERE id = ${userId}
`;
```

### PHP

```php
<?php

// ❌ 存在漏洞：字符串拼接
$sql = "SELECT * FROM users WHERE email = '" . $_GET['email'] . "'";
$user = $pdo->query($sql)->fetch();

// ✅ PDO 预处理语句
$stmt = $pdo->prepare("SELECT * FROM users WHERE email = :email");
$stmt->execute(['email' => $email]);
$user = $stmt->fetch(PDO::FETCH_ASSOC);

// ✅ PDO 位置占位符
$stmt = $pdo->prepare("SELECT * FROM users WHERE id = ?");
$stmt->execute([$id]);

// ❌ mysqli 使用字符串插值
$result = mysqli_query($conn,
    "SELECT * FROM users WHERE id = " . $id
);

// ✅ mysqli 预处理语句
$stmt = mysqli_prepare($conn, "SELECT * FROM users WHERE id = ?");
mysqli_stmt_bind_param($stmt, "i", $id);
mysqli_stmt_execute($stmt);

// ✅ Laravel Eloquent ORM
User::where('id', $id)->first();

// ❌ Laravel DB::raw 使用插值
DB::select(DB::raw("SELECT * FROM users WHERE id = {$id}"));

// ✅ Laravel 参数化原生查询
DB::select("SELECT * FROM users WHERE id = ?", [$id]);
```

### C# / .NET

```csharp
// ❌ 存在漏洞：字符串拼接
var query = $"SELECT * FROM Users WHERE Id = {userId}";
using var cmd = new SqlCommand(query, connection);
var reader = cmd.ExecuteReader();

// ✅ ADO.NET 参数化查询
var query = "SELECT * FROM Users WHERE Id = @Id";
using var cmd = new SqlCommand(query, connection);
cmd.Parameters.AddWithValue("@Id", userId);

// ✅ Dapper 参数化查询
var users = connection.Query<User>(
    "SELECT * FROM Users WHERE Id = @Id",
    new { Id = userId }
);

// ❌ Dapper 使用字符串插值
var users = connection.Query<User>(
    $"SELECT * FROM Users WHERE Id = {userId}"
);

// ✅ EF Core（默认参数化）
var user = await context.Users
    .Where(u => u.Id == userId)
    .FirstOrDefaultAsync();

// ❌ EF Core FromSqlRaw 使用插值
var users = context.Users
    .FromSqlRaw($"SELECT * FROM Users WHERE Id = {userId}")
    .ToList();

// ✅ EF Core FromSql 使用 FormattableString（参数化）
var users = context.Users
    .FromSql($"SELECT * FROM Users WHERE Id = {userId}")
    .ToList();
```

---

## ORM 的不安全用法

ORM 并不能在所有情况下自动防止 SQL 注入：

```python
# ❌ SQLAlchemy: text() with f-string
session.execute(text(f"SELECT * FROM users WHERE id = {user_id}"))

# ❌ Django：extra() / RawSQL() 使用字符串插值
User.objects.extra(where=[f"username = '{username}'"])
User.objects.annotate(
    val=RawSQL(f"SELECT col FROM other WHERE id = {user_id}")
)

# ❌ JPA：createNativeQuery 使用字符串拼接
entityManager.createNativeQuery("SELECT * FROM users WHERE name = '" + name + "'")

# ❌ EF Core：FromSqlRaw 使用字符串插值
context.Users.FromSqlRaw($"SELECT * FROM Users WHERE Id = {userId}")
```

**规则：** 每种 ORM 都提供原生 SQL 入口。在此处插值拼接不可信数据会产生 SQL 注入。始终使用 ORM 的参数绑定机制。

---

## 动态标识符：表名与列名

占位符只能绑定**值**，不能绑定表名、列名或 SQL 关键字。动态标识符采用以下方式处理：

```python
# ✅ 允许列表校验
ALLOWED_COLUMNS = {"id", "name", "email", "created_at"}
ALLOWED_DIRECTIONS = {"ASC", "DESC"}

def get_users(order_by: str, direction: str) -> list[User]:
    if order_by not in ALLOWED_COLUMNS:
        raise ValueError(f"Invalid column: {order_by}")
    if direction.upper() not in ALLOWED_DIRECTIONS:
        raise ValueError(f"Invalid direction: {direction}")

    return User.objects.order_by(
        f"{'-' if direction.upper() == 'DESC' else ''}{order_by}"
    )
```

---

## 检测与测试

```bash
# 自动化扫描
sqlmap -u "https://example.com/api/users?id=1" --batch

# 静态分析（Python）
bandit -r src/ -f custom

# 静态分析（Java）
spotbugs -textui build/classes

# 代码检视时应搜索的关键词
grep -rn "f\".*SELECT\|f'.*SELECT\|fmt.Sprintf.*SELECT\|format.*SELECT" src/
grep -rn "query.*\+.*\|query.*&\|query.*concat" src/
```

---

## 检视清单

- [ ] 所有 SQL 使用参数化查询，不插值拼接字符串
- [ ] ORM 原生 SQL 方法使用绑定参数，不使用字符串格式化
- [ ] 动态表名、列名等标识符经过白名单校验
- [ ] 数据库账号遵循最小权限，应用账号无 DROP/ALTER 权限
- [ ] 不存在未经参数化就将用户输入构造成 SQL 的情况
- [ ] CI 运行 Bandit、SpotBugs、SonarQube 等静态分析工具
