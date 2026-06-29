# Windows 代码签名 (Code Signing)

Windows 的 **SmartScreen** 和更严格的 **智能应用控制 (Smart App Control, SAC)** 会拦截
“未签名 / 无信誉” 的程序。SAC 开启时甚至不给 “仍要运行” 按钮 —— 唯一体面的解法就是
给 exe 做**代码签名**。

打包脚本已内置签名步骤:**配了证书就自动签,没配就照常出未签名版**。
日常开发不用证书;要对外发布时,设好下面的环境变量再跑同样的打包命令即可。

---

## 1. 买什么证书

- **EV 代码签名证书(推荐)** —— 被 SmartScreen/SAC **立即信任**,新版本也不用“养信誉”。
  - 颁发商:DigiCert、Sectigo、SSL.com、GlobalSign 等。
  - 2023 年后私钥**必须存在硬件上**:多为 **USB 硬件令牌**,或厂商的**云签名 KSP**。
- **OV(标准)代码签名证书** —— 更便宜,但 SmartScreen 下要慢慢积累下载信誉,**SAC 可能仍拦**。不推荐用于 SAC。
- **Azure Trusted Signing(微软云签名)** —— 便宜(约 $10/月),**被 SAC 信任**,无需买硬件令牌。需要企业/个人身份验证。是 EV 之外的高性价比选择。

> 证书由你购买、持有、保管。本项目脚本只负责“调用 signtool 去签”,不接触你的私钥/令牌 PIN。

---

## 2. 配置(四选一,按你的证书类型)

打包前在终端设置环境变量(PowerShell 用 `$env:NAME="..."`):

### ① 硬件令牌 / 云 KSP / 证书库 —— 按指纹(EV 最常用)
证书装好后(令牌驱动或导入到 `证书 - 当前用户\个人`),拿到 **SHA-1 指纹**:
```powershell
Get-ChildItem Cert:\CurrentUser\My | Format-List Subject, Thumbprint
```
```powershell
$env:CODEXAPP_SIGN_SHA1 = "你的证书指纹"      # 例 49A45993DFE4...
```
> 用 USB 令牌时,签名时可能会弹窗让你输 **PIN**。

### ② 按证书主题名(证书库里只有一个匹配证书时)
```powershell
$env:CODEXAPP_SIGN_SUBJECT = "Your Company, Inc."
```

### ③ PFX 文件(仅 OV / 测试 —— 真 EV 私钥导不出成 PFX)
```powershell
$env:CODEXAPP_SIGN_PFX  = "C:\path\cert.pfx"
$env:CODEXAPP_SIGN_PASS = "证书密码"
```

### ④ Azure Trusted Signing
```powershell
$env:CODEXAPP_SIGN_AZURE = "C:\path\metadata.json"
$env:CODEXAPP_AZURE_DLIB = "C:\path\Azure.CodeSigning.Dlib.dll"
```

### 可选项
```powershell
$env:CODEXAPP_SIGN_TS   = "http://timestamp.sectigo.com"   # 时间戳服务器(默认即此)
$env:CODEXAPP_SIGNTOOL  = "C:\...\signtool.exe"            # 手动指定 signtool 路径
$env:CODEXAPP_SIGN      = "0"                              # 临时强制关闭签名
```

---

## 3. 打包(命令不变,自动签名)

设好上面的变量后:

```powershell
# 单文件版  ->  dist\CodexApp-Agent.exe
node cloud\build-agent.mjs

# 原生窗口版 ->  desktop\dist\CodexApp-win32-x64\  +  CodexApp-portable-win64.zip
cd desktop
npm run dist:portable
```

每个产物都会自动 `signtool sign`(带 RFC3161 时间戳)并 `signtool verify /pa` 校验。
**校验通过 = 证书链可信**;若用自签证书会报 “root ... not trusted”(预期),正式 EV 证书则为 `Valid`。

---

## 4. 验证签名是否生效

```powershell
Get-AuthenticodeSignature .\dist\CodexApp-Agent.exe | Format-List Status, SignerCertificate, TimeStamperCertificate
```
`Status` 应为 **Valid**,`SignerCertificate` 是你的证书,`TimeStamperCertificate` 非空。

---

## 前置条件

- **signtool.exe**:随 Windows SDK 提供(脚本会自动从 `Windows Kits\10\bin\*\x64` 找到)。
  没有的话装 “Windows SDK” 即可。
- 联网(签名要访问时间戳服务器)。

---

## 附:Azure Trusted Signing 完整步骤(便宜 + 被 SAC 信任)

约 $9.99/月,无需买硬件令牌。分三部分。

### A. Azure 门户开通(你来做,含审核约 1–3 个工作日)

1. 登录 <https://portal.azure.com>,绑定付款方式。
2. 搜索并创建 **Trusted Signing Account** 资源:
   - 选一个**支持的区域**(如 East US、West US 3、West Central US、North Europe、West Europe)。
   - 定价档选 **Basic**(约 $9.99/月)。
   - 记下 **账户名** 和该区域的 **Endpoint**(形如 `https://eus.codesigning.azure.net/`)。
3. 在该账户下创建 **Identity Validation(身份验证)**:
   - **组织**:需 3 年以上可查证的法人历史。
   - **个人(Individual)**:走个人身份验证(已开放个人开发者)。
   - 提交资料后等微软审核(几个工作日)。
4. 审核通过后,创建 **Certificate Profile(证书配置)**:
   - 类型选 **Public Trust**,关联上一步验证好的身份。
   - 记下 **证书配置名(CertificateProfileName)**。
5. 在 Trusted Signing 账户的 **访问控制 (IAM)** 里,给“将要用来签名的账号/服务主体”分配角色:
   **Trusted Signing Certificate Profile Signer**。

> 第 2–5 步都在 Azure 门户里,需要你的账号和身份资料,助手无法代办。

### B. 本机工具(助手可帮你装/配)

1. 装 **.NET SDK**(取签名 dlib 用)和 **Azure CLI**(登录认证用):
   ```powershell
   winget install Microsoft.DotNet.SDK.8
   winget install Microsoft.AzureCLI
   ```
2. 取签名 dlib(`Azure.CodeSigning.Dlib.dll`):
   ```powershell
   nuget install Microsoft.Trusted.Signing.Client -OutputDirectory C:\trusted-signing
   # dll 在 C:\trusted-signing\Microsoft.Trusted.Signing.Client.<ver>\bin\x64\Azure.CodeSigning.Dlib.dll
   ```
   (没有 nuget.exe 时,用 `dotnet` 还原一个含该包的工程也可以拿到这个 dll。)
3. 登录有 **Signer 角色** 的账号:
   ```powershell
   az login
   ```
   (无人值守的自动化构建则改用服务主体环境变量 `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` / `AZURE_CLIENT_SECRET`。)
4. 复制 `trusted-signing.example.json` 为 `trusted-signing.json`,填上你的 **Endpoint / 账户名 / 证书配置名**。

### C. 出签名包(命令不变)

```powershell
$env:CODEXAPP_SIGN_AZURE = "C:\test\CodexAPP\trusted-signing.json"
$env:CODEXAPP_AZURE_DLIB = "C:\trusted-signing\Microsoft.Trusted.Signing.Client.<ver>\bin\x64\Azure.CodeSigning.Dlib.dll"

node cloud\build-agent.mjs        # 单文件版
cd desktop ; npm run dist:portable # 原生版 + zip
```

跑完用 `Get-AuthenticodeSignature` 应看到 `Status: Valid`,签名者为 Microsoft 颁发的 Public Trust 证书。
