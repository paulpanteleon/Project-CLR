# Security Research Report: Database Layer

## Introduction

The database layer is where an application's most valuable asset, its data, is stored, queried, and modified. Most breaches that expose customer records, credentials, or financial information pass through this layer, whether the attacker reaches it directly through an injection flaw, indirectly through a compromised application account, or through an exposed administrative interface. This report surveys the categories of attack that can occur at the database layer, explains how attackers reach each one and what they gain, and sets out the hardening measures development and product teams should apply. It is organized around the OWASP Top 10:2025 and draws on the OWASP Database Security Cheat Sheet and SQL Injection Prevention Cheat Sheet. It covers relational databases (MySQL, MariaDB, PostgreSQL, SQL Server) and NoSQL and key-value stores (MongoDB, Redis), where attack syntax differs but the underlying causes are the same.

## Layer

The database layer sits behind the application or business-logic tier. In a typical three-tier design, a browser or mobile client calls a web or API server over HTTPS. The server builds queries from request input and session context, and sends them over a separate connection to the database engine, usually a TCP listener on a well-known port (3306 for MySQL, 5432 for PostgreSQL, 1433 for SQL Server, 27017 for MongoDB, 6379 for Redis). The engine contains several components that matter for security: a network listener, an authentication module, a privilege system of users, roles, and grants, a parser and optimizer, a storage engine, and administrative features such as stored procedures, extensions, file functions, backup utilities, and remote admin consoles.

From a network standpoint, three properties determine exposure: who can reach the listener, how each connection is authenticated and encrypted, and which identity the application uses once connected. Because the application tier must hold credentials and talk to the database continuously, it is a high-value target. Any compromised component that can send queries is, in practice, a compromise of the data.

## Vulnerabilities

The categories below are grouped by the OWASP Top 10:2025 category that most directly governs them. Real incidents usually chain several of them: an injection flaw is used to read a configuration file, the credentials it contains grant superuser access, and the superuser account is then used to reach an exposed administrative port.

### Injection (OWASP A05:2025)

Injection occurs when untrusted input is concatenated into a query so that it changes the query's structure instead of supplying a data value. A login query built by string concatenation can be bypassed by submitting `' OR '1'='1` as the username. Classic in-band SQL injection (CWE-89) returns data in the response. Error-based injection extracts data from database error messages, UNION-based injection appends a second query to read other tables, blind injection infers data one true/false or timing result at a time, and out-of-band injection exfiltrates data through DNS or HTTP requests initiated by the database. Consequences include credential and personal data disclosure, record modification or deletion, authentication and authorization bypass, and on some engines operating system command execution through extended procedures or file functions. CVE-2023-34362, a SQL injection flaw in Progress MOVEit Transfer, was mass-exploited in 2023 to steal data from many organizations' file-transfer databases.

NoSQL stores have analogous flaws. In MongoDB-backed applications, operator injection (CWE-943) occurs when a JSON object such as `{"$ne": null}` is accepted in place of a string, so a password check matches any user. JavaScript execution through `$where` clauses and command injection into Redis protocol strings are further examples.

### Authentication Failures (OWASP A07:2025)

Common weaknesses include default or weak database passwords, shared accounts used by many services, credentials hard-coded in source code or configuration (CWE-798), and passwords stored in plaintext or with reversible encryption (CWE-256, CWE-312). An attacker who finds a connection string in a public repository, container image, or exposed configuration file can connect directly to the database and bypass every application control. Database servers bound to all interfaces without authentication, which is common with Redis and MongoDB, are scanned continuously and have been wiped or ransomed at scale. Redis CVE-2022-0543, a Lua sandbox escape in the Debian-packaged build, allowed remote code execution by authenticated users and was exploited against exposed instances.

### Broken Access Control and Privilege Escalation (OWASP A01:2025)

Access control failures let a principal read or change data outside its intended scope. The application may connect as a superuser or owner account (`sa`, `root`, `postgres`, `SYS`), so any injection flaw inherits full administrative rights (CWE-250). Horizontal escalation, often called insecure direct object reference, occurs when a query filters on a user-supplied identifier without checking ownership, so one user can read another's rows (CWE-639). Vertical escalation occurs when a low-privilege role can grant itself more rights, or when dangerous features such as `xp_cmdshell` in SQL Server, the `FILE` privilege in MySQL, or `COPY ... PROGRAM` in PostgreSQL are available to an application account. Missing tenant filters in multi-tenant systems are especially damaging because one omitted condition exposes every customer's data. SSRF, which OWASP folded into this category in 2025, can reach internal database admin interfaces or cloud metadata services that issue database credentials.

### Security Misconfiguration (OWASP A02:2025)

Misconfiguration is the most common cause of exposed databases. Typical problems include listeners bound to `0.0.0.0` with no firewall, administrative tools such as phpMyAdmin, pgAdmin, or Mongo Express reachable without authentication, default accounts and sample databases left in place, verbose errors that reveal query text or stack traces (CWE-209), and unnecessary server features enabled. Unencrypted connections expose credentials and result sets to anyone on the network path (CWE-319). Backups on shared drives or in cloud buckets with weak permissions can expose the full dataset without touching the live database.

### Cryptographic Failures (OWASP A04:2025)

Sensitive fields may be stored in plaintext (CWE-311), backups may be unencrypted, and passwords may be hashed with fast or obsolete functions such as unsalted MD5 or SHA-1 instead of adaptive algorithms such as Argon2id, scrypt, bcrypt, or PBKDF2. Once a dump is stolen, weak hashing converts a single breach into mass account takeover. Where fields are not encrypted at the application level, even a read-only injection exposes them in clear text.

### Insecure Design and Business Logic (OWASP A06:2025)

Some database attacks exploit design rather than coding slips. Race conditions (CWE-362) in inventory decrements, coupon redemption, or balance transfers let parallel requests all pass a check before any update commits. Mass assignment (CWE-915) lets a client set columns it should not control, such as `is_admin`, when an ORM binds request bodies directly to models. Unbounded queries and missing pagination enable resource exhaustion (CWE-400).

### Logging and Alerting Failures (OWASP A09:2025)

Without audit records for logins, privilege changes, schema changes, and bulk reads, a database compromise can persist for months. Attackers commonly alter or truncate logs after exfiltration. Conversely, logs that record full query text with personal data or credentials create a second exposure.

### Supply Chain, Integrity, and Exceptional Conditions (OWASP A03, A08, and A10:2025)

Drivers, ORMs, plugins, and database container images are third-party components, and a vulnerable or malicious one can expose data regardless of application quality. Migrations and stored procedures deployed from unreviewed scripts can introduce backdoors or triggers. The Redis CVE-2022-0543 case shows how an operating-system packaging decision can create a critical flaw in a product the upstream project did not ship. Mishandling exceptional conditions (A10:2025) matters too: a connection pool that fails open under load, or a query that returns partial results after a timeout, can cause silent data corruption or authorization bypass.

## Challenges of Securing This Layer

The first challenge is that the database trusts the application by design. Every query from the service account is treated as legitimate, so a flaw in one module carries the full authority of that account, and the engine has no native way to tell whether a query came from the intended code path. Defense must therefore be applied in two places: in the application, where queries are built, and in the database, where privileges are enforced.

The second challenge is that the same data is reached through many paths, including APIs, background jobs, reporting exports, analytics tools, admin consoles, and developer machines. Each path has its own authentication and logging, and a control applied to one path is easily bypassed through another. Test and analytics copies of production data often carry weaker protections.

Third, dynamic queries are often unavoidable for search, filtering, and sorting, and parameterization does not cover everything. Identifiers such as table names, column names, and `ORDER BY` clauses cannot be bound as ordinary parameters in most drivers, which tempts developers back into concatenation. NoSQL query languages look safe because they are JSON, yet they accept operator objects whenever request bodies are passed through unvalidated.

Fourth, schemas and grants change constantly. Least-privilege roles must be updated with every migration, and overly broad grants accumulate because removing them risks breaking production. Incident response often grants temporary superuser access that is never revoked.

Fifth, engines differ widely in defaults, feature sets, and security models, so a control that works in PostgreSQL may not carry over to MongoDB. Finally, detection alone is weak here. Exfiltration through a legitimate-looking query is hard to separate from normal reporting traffic without baselines and behavioral analytics.

## How to Fix the Vulnerabilities

The strongest defenses address root causes rather than individual payloads. The OWASP cheat sheets recommend layered controls, summarized below by key area.

### Parameterized queries and safe query construction

Parameterized queries and prepared statements are the primary defense against SQL injection (CWE-89). The query structure and the data are sent separately, so input is never parsed as SQL. Teams should use ORM parameter binding and avoid raw query APIs unless they are parameterized. Where identifiers must vary, such as sort columns, map user choices to a fixed allowlist of column names. For NoSQL, validate that request fields are primitive types, reject keys beginning with `$`, and enforce schema validation so operator objects cannot stand in for values. Stored procedures help only if they use parameters internally, since dynamic SQL inside a procedure remains injectable.

### Least privilege

Each service should have its own database account with only the permissions it needs. OWASP notes that most applications need only `SELECT`, `UPDATE`, and `DELETE`, plus `INSERT` where required, on specific tables. Applications should never own the database or hold superuser or sysadmin roles. Migrations should run under a separate account with DDL rights, and runtime accounts should not have them. Dangerous features such as `xp_cmdshell`, CLR execution, the MySQL `FILE` privilege, database links, and `COPY PROGRAM` should be disabled unless needed. For tenant isolation, use row-level security policies or views so that a missing application filter does not expose other customers' data.

### Authorization enforced on every data path

Queries that return user-specific data should include the authenticated principal's identifier, taken from the server-side session and never from request parameters. Authorization should be centralized in a service layer so that every access path applies the same policy. Unguessable identifiers help but are not a substitute for ownership checks.

### Authentication and credential management

Require authentication for every connection, including local ones, and give each service a unique, rotated credential. Prefer integrated or certificate-based authentication where available, such as Windows authentication for SQL Server or IAM authentication for cloud databases. Keep secrets out of source code, images, and web-accessible directories, store them in a secrets manager or injected environment variables, and exclude them from version control. Remove default accounts and retired applications' accounts promptly.

### Network exposure and administrative interfaces

Bind listeners to private interfaces, isolate database hosts on internal network segments, and restrict access by source host and port. Clients should never connect to the database directly; they should go through an API that enforces access control. Administrative web tools should be removed from production or protected with strong authentication, HTTPS, and network restrictions. Run database services under low-privilege service accounts and patch engines and operating systems on a fixed schedule.

### Encryption in transit, at rest, and in storage

Require TLS 1.2 or later with modern ciphers such as AES-GCM or ChaCha20, and have clients verify the server certificate. Encrypt backups and restrict their permissions. Use disk or transparent data encryption at rest, and add application-level encryption for especially sensitive fields such as government identifiers and payment data, with keys held outside the database. Hash passwords with Argon2id, scrypt, bcrypt, or PBKDF2, using per-user salts and current work factors.

### Error handling and data minimization

Return generic error messages to clients and log diagnostics server-side (CWE-209). Return only the columns each endpoint needs, and mask or tokenize sensitive values in responses, exports, and reports.

### Logging, monitoring, and alerting

Enable audit logging for logins and failures, privilege and schema changes, and access to sensitive tables. Forward logs to a system that database administrators cannot silently alter. Alert on bulk reads, connections from unexpected hosts, new accounts, and large exports. Keep credentials and unnecessary personal data out of logs.

### Supply chain and development lifecycle

Pin and scan dependencies, including ORMs, drivers, and database images, and track advisories for the exact engine version in use. Review migrations and stored procedures through the same code-review process as application code. Keep production data out of test environments or mask it first. Run static analysis and automated injection tests, such as DAST scans, in continuous integration.

### Integrity and concurrency

Enforce business invariants with constraints, unique indexes, and check constraints rather than application logic alone. Use transactions with appropriate isolation and locking, such as `SELECT ... FOR UPDATE` or version columns, for inventory and balance operations. Apply field allowlists to prevent mass assignment, and set pagination limits and query timeouts to contain resource exhaustion.

### OWASP secure coding principles

The OWASP principles most relevant here are to validate input against an allowlist of expected form and type, use parameterized interfaces for all data access, apply least privilege to application and database accounts, escape only where parameterization is impossible and only with context-specific functions, fail securely without revealing internal detail, and log security-relevant events without recording secrets. Development and product teams should treat the database as a trust boundary and design on the assumption that the application tier will sometimes be compromised.

## References

- OWASP Top 10:2025, <https://owasp.org/Top10/2025/0x00_2025-Introduction/>
- OWASP Database Security Cheat Sheet, <https://cheatsheetseries.owasp.org/cheatsheets/Database_Security_Cheat_Sheet.html>
- OWASP SQL Injection Prevention Cheat Sheet, <https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html>
- OWASP Query Parameterization Cheat Sheet, <https://cheatsheetseries.owasp.org/cheatsheets/Query_Parameterization_Cheat_Sheet.html>
- CVE-2023-34362 (MOVEit Transfer), <https://nvd.nist.gov/vuln/detail/CVE-2023-34362>
- CVE-2022-0543 (Redis Debian package), <https://nvd.nist.gov/vuln/detail/CVE-2022-0543>
- MITRE Common Weakness Enumeration, <https://cwe.mitre.org>
