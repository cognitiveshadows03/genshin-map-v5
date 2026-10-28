using Mono.Cecil;
using Mono.Cecil.Cil;
using System.Security.Cryptography;
using System.Text.Json;

static class Program
{
    static readonly List<string> Changes = new();

    static int Main(string[] args)
    {
        if (args.Length >= 4 && args[0] == "dump") return Dump(args);
        if (args.Length >= 3 && args[0] == "find") return Find(args);
        if (args.Length == 4 && args[0] == "patch") return Patch(args[1], args[2], args[3]);
        if (args.Length == 4 && args[0] == "audit") return Audit(args[1], args[2], args[3]);
        Console.Error.WriteLine("Usage:");
        Console.Error.WriteLine("  OfflinePatcher patch <HotFix.dll> <NotHotfix.dll> <output-directory>");
        Console.Error.WriteLine("  OfflinePatcher audit <HotFix.dll> <NotHotfix.dll> <report.json>");
        Console.Error.WriteLine("  OfflinePatcher dump <assembly> <type> <method>");
        Console.Error.WriteLine("  OfflinePatcher find <assembly> <text>");
        return 2;
    }

    static int Patch(string hotfixPath, string notHotfixPath, string outputDirectory)
    {
        // Guard against silently patching a different official client build.
        ExpectSha256(hotfixPath, Environment.GetEnvironmentVariable("KONGYING_HOTFIX_SHA256"));
        ExpectSha256(notHotfixPath, Environment.GetEnvironmentVariable("KONGYING_NOTHOTFIX_SHA256"));
        Directory.CreateDirectory(outputDirectory);
        using var resolver = new DefaultAssemblyResolver();
        resolver.AddSearchDirectory(Path.GetDirectoryName(Path.GetFullPath(hotfixPath))!);
        resolver.AddSearchDirectory(Path.GetDirectoryName(Path.GetFullPath(notHotfixPath))!);
        var reader = new ReaderParameters { AssemblyResolver = resolver };
        using var hotfix = AssemblyDefinition.ReadAssembly(hotfixPath, reader);
        using var notHotfix = AssemblyDefinition.ReadAssembly(notHotfixPath, reader);
        PatchHotfix(hotfix.MainModule);
        PatchNotHotfix(notHotfix.MainModule);
        hotfix.Write(Path.Combine(outputDirectory, "HotFix.dll"));
        notHotfix.Write(Path.Combine(outputDirectory, "NotHotfix.dll"));
        File.WriteAllLines(Path.Combine(outputDirectory, "managed-patches.txt"), Changes);
        Console.WriteLine($"Applied {Changes.Count} managed offline patches.");
        foreach (string change in Changes) Console.WriteLine(change);
        return 0;
    }

    static void ExpectSha256(string path, string? expected)
    {
        if (string.IsNullOrWhiteSpace(expected)) return;
        string actual = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path))).ToLowerInvariant();
        if (!actual.Equals(expected, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"Unexpected input assembly hash for {path}: {actual}");
    }

    static int Audit(string hotfixPath, string notHotfixPath, string reportPath)
    {
        using var hotfix = AssemblyDefinition.ReadAssembly(hotfixPath);
        using var notHotfix = AssemblyDefinition.ReadAssembly(notHotfixPath);
        var checks = new List<object>();
        void Check(string name, bool passed) => checks.Add(new { name, passed });

        var appCtor = GetMethod(GetType(notHotfix.MainModule, "AppStatic"), ".cctor");
        Check("portable data path uses Application.dataPath", Calls(appCtor, "UnityEngine.Application", "get_dataPath") &&
            !Calls(appCtor, "UnityEngine.Application", "get_persistentDataPath"));
        var language = GetMethod(GetType(notHotfix.MainModule, "LanguageManager"), "SetShowLanguage");
        Check("language selection is local", Calls(language, "UTS", "ParseJson") &&
            !Calls(language, "MyUnityWebRequest", "DownloadFile"));
        var requests = GetType(notHotfix.MainModule, "MyUnityWebRequest");
        var requestMethods = requests.Methods.Where(m => m.IsPublic && new[] { "Get", "DownloadFile",
            "DownloadFiles", "DownloadFiles2", "GetTexture", "GetAssetBundle", "GetAudioClip",
            "Post", "UploadByPut" }.Contains(m.Name)).ToArray();
        Check("all public web-request helpers are disabled", requestMethods.Length == 10 && requestMethods.All(IsNoOp));
        var tracker = GetType(notHotfix.MainModule, "cvAutoTrackCSharpImpl.cvAutoTrack");
        var wan = tracker.Methods.Single(m => m.Name == "GetWANIp" && m.ReturnType.FullName == "System.Void");
        Check("tracking does not discover a WAN IP", !Calls(wan, "UnityEngine.MonoBehaviour", "StartCoroutine"));

        var downloadType = GetType(hotfix.MainModule, "DownloadJson");
        var startup = GetMethod(downloadType, "StartDownload");
        var offlineScene = GetMethod(downloadType, "LoadOfflineScene");
        Check("startup initializes local data and loads YSDT after Main settles", Calls(startup, "MonoController", "StartInit") &&
            Calls(startup, "UnityEngine.MonoBehaviour", "Invoke") && Calls(startup, "System.GC", "Collect") &&
            Calls(offlineScene, "TEngine.SceneModule", "LoadScene") &&
            !Calls(startup, "MyUnityWebRequest", "DownloadFile") && !Calls(startup, "UnityEngine.MonoBehaviour", "InvokeRepeating"));
        var sceneCompleted = GetMethod(downloadType, "OfflineSceneCompleted");
        Check("scene transition retries while Main is busy and reports completion", Calls(offlineScene,
            "UnityEngine.MonoBehaviour", "Invoke") && Calls(sceneCompleted, "YooAsset.HandleBase", "get_Status") &&
            Calls(sceneCompleted, "YooAsset.HandleBase", "get_LastError"));
        var git = GetType(hotfix.MainModule, "GitFunction");
        var loading = GetMethod(git, "LoadingComplete");
        Check("loading uses local saves without cloud login", Calls(loading, "PlayerPref", "LoadLocal") &&
            Calls(loading, "GameController", "InitDefaultCount2") && !Calls(loading, "GitFunction", "Login") &&
            !Calls(loading, "UnityEngine.MonoBehaviour", "InvokeRepeating"));
        foreach (string name in new[] { "GetCurrentTime", "GetCurrentWebTime" })
        {
            var method = GetMethod(git, name);
            Check(name + " uses the device clock", Calls(method, "System.DateTime", "get_Now") &&
                !Calls(method, "UnityEngine.MonoBehaviour", "StartCoroutine"));
        }
        var cloudNames = new[] { "Login", "RefreshToken", "GetUserData", "GetGistList", "FirstGetGistList",
            "GetGistSingle", "AutoUpdateGistContent", "UpdateGistContent", "UpdateGistContentWithContent",
            "UpdateGistSave", "UpdateGistDescription", "DeleteGistFile", "AddGistFile", "AddHistoryGistFile", "AddGistSave" };
        var cloudMethods = git.Methods.Where(m => m.IsPublic && cloudNames.Contains(m.Name)).ToArray();
        Check("direct cloud-save entry points are disabled", cloudMethods.All(IsNoOp));
        foreach (var (typeName, methodName) in new[] { ("IconController", "LoadSprite"), ("POIObj", "CheckSpecialIconOverride") })
        {
            var method = GetMethod(GetType(hotfix.MainModule, typeName), methodName);
            Check(typeName + " uses local icon files", Calls(method, "ItemSelect", "LoadByIo") &&
                !Calls(method, "MyUnityWebRequest", "DownloadFile"));
        }
        var popup = GetType(hotfix.MainModule, "PopupShowHide");
        var imageMoveNext = GetMethod(popup.NestedTypes.Single(t => t.Name.Contains("<GetImage>d__")), "MoveNext");
        Check("remote marker comment images are not requested", imageMoveNext.Body.Instructions.Count == 2 &&
            imageMoveNext.Body.Instructions[0].OpCode == OpCodes.Ldc_I4_0 &&
            imageMoveNext.Body.Instructions[1].OpCode == OpCodes.Ret);
        Check("version check disabled", IsNoOp(GetMethod(GetType(hotfix.MainModule, "GameController"), "ReCheckVersion")));
        Check("companion process is not auto-launched", IsNoOp(GetMethod(GetType(hotfix.MainModule, "OtherProcess"), "OpenOtherProcess")));
        Check("notices are not downloaded", IsNoOp(GetMethod(GetType(hotfix.MainModule, "Notice"), "Start")) &&
            IsNoOp(GetMethod(GetType(hotfix.MainModule, "Notice"), "ReDownloadNotice")));
        Check("analytics entry points are disabled", IsNoOp(GetMethod(GetType(hotfix.MainModule, "Utils"), "SendEvent")) &&
            IsNoOp(GetMethod(GetType(hotfix.MainModule, "Utils"), "SendPageview")));

        bool passed = checks.All(c => (bool)c.GetType().GetProperty("passed")!.GetValue(c)!);
        var report = new
        {
            schemaVersion = 1, passed,
            hotfixSha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(hotfixPath))).ToLowerInvariant(),
            notHotfixSha256 = Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(notHotfixPath))).ToLowerInvariant(),
            checks,
        };
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(reportPath))!);
        File.WriteAllText(reportPath, JsonSerializer.Serialize(report, new JsonSerializerOptions { WriteIndented = true }));
        Console.WriteLine($"Managed audit: {(passed ? "PASS" : "FAIL")} ({checks.Count} checks)");
        return passed ? 0 : 1;
    }

    static bool Calls(MethodDefinition method, string declaringType, string name) =>
        method.HasBody && method.Body.Instructions.Any(i => i.Operand is MethodReference mr &&
            mr.DeclaringType.FullName == declaringType && mr.Name == name);

    static bool IsNoOp(MethodDefinition method) => method.HasBody && method.Body.Instructions.Count == 1 &&
        method.Body.Instructions[0].OpCode == OpCodes.Ret;

    static void PatchNotHotfix(ModuleDefinition module)
    {
        // Keep saves and all seeded data in Map_Data beside the executable. The
        // same dataPath redirect is applied to the early AOT static constructor.
        var appStatic = GetType(module, "AppStatic");
        var cctor = GetMethod(appStatic, ".cctor");
        var pathInstruction = Single(cctor.Body.Instructions, i =>
            i.Operand is MethodReference mr && mr.Name == "get_persistentDataPath");
        var getDataPath = Clone((MethodReference)pathInstruction.Operand);
        getDataPath.Name = "get_dataPath";
        pathInstruction.Operand = getDataPath;
        Changed("AppStatic: use Map_Data for portable local data");

        var concat = FindRef(module, "System.String", "Concat", 2);
        var language = GetType(module, "LanguageManager");
        var setLanguage = GetMethod(language, "SetShowLanguage");
        var languagesField = GetField(language, "languages");
        var langDicField = GetField(language, "LangExDic");
        var resetField = GetField(language, "ReSetLanguage");
        var parseLanguages = FindRef(module, "UTS", "ParseJson", 1, "LanguageStr");
        var parseDictionary = FindRef(module, "LanguageManager", "ParseJson", 1, "Dictionary");
        var contains = FindRef(module, "System.String", "Contains", 1);
        var replace = FindRef(module, "System.String", "Replace", 2);
        var setString = FindRef(module, "UnityEngine.PlayerPrefs", "SetString", 2);
        var getString = FindRef(module, "UnityEngine.PlayerPrefs", "GetString", 1);
        var invoke = FindRef(module, "System.Action", "Invoke", 0);
        var ret = Instruction.Create(OpCodes.Ret);
        var replaceDone = Instruction.Create(OpCodes.Ldarg_0);
        var languageReady = Instruction.Create(OpCodes.Ldarg_0);
        ReplaceBody(setLanguage, new[]
        {
            I(OpCodes.Ldarg_1), I(OpCodes.Ldstr, ".json"), I(OpCodes.Callvirt, contains),
            I(OpCodes.Brfalse_S, replaceDone),
            I(OpCodes.Ldarg_1), I(OpCodes.Ldstr, ".json"), I(OpCodes.Ldstr, ""),
            I(OpCodes.Callvirt, replace), I(OpCodes.Starg_S, setLanguage.Parameters[0]),
            replaceDone,
            I(OpCodes.Ldstr, "Resources/file_lang_MD5"), I(OpCodes.Call, parseLanguages),
            I(OpCodes.Stfld, languagesField),
            I(OpCodes.Ldstr, "Language"), I(OpCodes.Ldarg_1), I(OpCodes.Ldstr, ".json"),
            I(OpCodes.Call, concat), I(OpCodes.Call, setString),
            I(OpCodes.Ldarg_0), I(OpCodes.Ldstr, "Language"), I(OpCodes.Call, getString),
            I(OpCodes.Call, parseDictionary), I(OpCodes.Stfld, langDicField),
            I(OpCodes.Ldarg_0), I(OpCodes.Ldfld, langDicField), I(OpCodes.Brtrue_S, languageReady),
            I(OpCodes.Ldstr, "Language"), I(OpCodes.Ldstr, "en-US.json"), I(OpCodes.Call, setString),
            I(OpCodes.Ldarg_0), I(OpCodes.Ldstr, "Language"), I(OpCodes.Call, getString),
            I(OpCodes.Call, parseDictionary), I(OpCodes.Stfld, langDicField),
            languageReady, I(OpCodes.Ldfld, resetField), I(OpCodes.Brfalse_S, ret),
            I(OpCodes.Ldarg_0), I(OpCodes.Ldfld, resetField), I(OpCodes.Callvirt, invoke), ret,
        });
        Changed("LanguageManager: load manifest and translations only from bundled files");

        // All helpers that used to construct remote UnityWebRequests are disabled.
        var requests = GetType(module, "MyUnityWebRequest");
        foreach (string name in new[] { "Get", "DownloadFile", "DownloadFiles", "DownloadFiles2",
                     "GetTexture", "GetAssetBundle", "GetAudioClip", "Post", "UploadByPut" })
            foreach (var method in requests.Methods.Where(m => m.Name == name && m.IsPublic)) NoOp(method);
        Changed("MyUnityWebRequest: removed all public remote request entry points");

        // Position tracking is outside this edition's scope; do not discover a WAN IP.
        var tracker = GetType(module, "cvAutoTrackCSharpImpl.cvAutoTrack");
        var getWan = tracker.Methods.Single(m => m.Name == "GetWANIp" &&
            m.ReturnType.FullName == "System.Void");
        var invokeString = FindRef(module, "System.Action`1<System.String>", "Invoke", 1);
        var wanRet = Instruction.Create(OpCodes.Ret);
        ReplaceBody(getWan, new[]
        {
            I(OpCodes.Ldarg_1), I(OpCodes.Brfalse_S, wanRet), I(OpCodes.Ldarg_1),
            I(OpCodes.Ldstr, ""), I(OpCodes.Callvirt, invokeString), wanRet,
        });
        Changed("Position tracking: disabled WAN-IP discovery");
    }

    static void PatchHotfix(ModuleDefinition module)
    {
        var download = GetType(module, "DownloadJson");
        var startDownload = GetMethod(download, "StartDownload");
        var startInit = FindRef(module, "MonoController", "StartInit", 0);
        var getMono = FindRef(module, "MonoController", "get_Instance", 0);
        var getScene = FindRef(module, "TEngine.GameModule", "get_Scene", 0);
        var loadScene = FindRef(module, "TEngine.SceneModule", "LoadScene", 7);
        var sceneHandleType = loadScene.ReturnType;
        var sceneCallbackType = loadScene.Parameters[4].ParameterType;
        var sceneCallbackCtor = new MethodReference(".ctor", module.TypeSystem.Void, sceneCallbackType)
        { HasThis = true };
        sceneCallbackCtor.Parameters.Add(new ParameterDefinition(module.TypeSystem.Object));
        sceneCallbackCtor.Parameters.Add(new ParameterDefinition(module.TypeSystem.IntPtr));
        var handleBase = module.ImportReference(sceneHandleType.Resolve().BaseType);
        var getStatus = module.ImportReference(handleBase.Resolve().Methods.Single(m => m.Name == "get_Status"));
        var getLastError = module.ImportReference(handleBase.Resolve().Methods.Single(m => m.Name == "get_LastError"));
        var toString = new MethodReference("ToString", module.TypeSystem.String, module.TypeSystem.Object)
        { HasThis = true };
        var concatString = FindRef(module, "System.String", "Concat", 2, "System.String,System.String");
        var debugLog = FindRef(module, "UnityEngine.Debug", "Log", 1);
        var invokeDelay = FindRef(module, "UnityEngine.MonoBehaviour", "Invoke", 2);

        var sceneCompleted = new MethodDefinition("OfflineSceneCompleted",
            MethodAttributes.Public | MethodAttributes.HideBySig, module.TypeSystem.Void);
        sceneCompleted.Parameters.Add(new ParameterDefinition(sceneHandleType));
        sceneCompleted.Body.Instructions.Add(I(OpCodes.Ldstr, "OFFLINE_YSDT completed. Status: "));
        sceneCompleted.Body.Instructions.Add(I(OpCodes.Ldarg_1));
        sceneCompleted.Body.Instructions.Add(I(OpCodes.Callvirt, getStatus));
        sceneCompleted.Body.Instructions.Add(Instruction.Create(OpCodes.Box, getStatus.ReturnType));
        sceneCompleted.Body.Instructions.Add(I(OpCodes.Callvirt, toString));
        sceneCompleted.Body.Instructions.Add(I(OpCodes.Call, concatString));
        sceneCompleted.Body.Instructions.Add(I(OpCodes.Call, debugLog));
        sceneCompleted.Body.Instructions.Add(I(OpCodes.Ldstr, "OFFLINE_YSDT error/detail: "));
        sceneCompleted.Body.Instructions.Add(I(OpCodes.Ldarg_1));
        sceneCompleted.Body.Instructions.Add(I(OpCodes.Callvirt, getLastError));
        sceneCompleted.Body.Instructions.Add(I(OpCodes.Call, concatString));
        sceneCompleted.Body.Instructions.Add(I(OpCodes.Call, debugLog));
        sceneCompleted.Body.Instructions.Add(I(OpCodes.Ret));
        download.Methods.Add(sceneCompleted);

        var loadOfflineScene = new MethodDefinition("LoadOfflineScene",
            MethodAttributes.Public | MethodAttributes.HideBySig, module.TypeSystem.Void);
        loadOfflineScene.Body.InitLocals = true;
        var sceneHandle = new VariableDefinition(sceneHandleType);
        loadOfflineScene.Body.Variables.Add(sceneHandle);
        var retryScene = Instruction.Create(OpCodes.Ldarg_0);
        var instructions = loadOfflineScene.Body.Instructions;
        instructions.Add(I(OpCodes.Call, getScene));
        instructions.Add(I(OpCodes.Ldstr, "YSDT"));
        instructions.Add(I(OpCodes.Ldc_I4_0));
        instructions.Add(I(OpCodes.Ldc_I4_0));
        instructions.Add(I(OpCodes.Ldc_I4_S, (sbyte)100));
        instructions.Add(I(OpCodes.Ldarg_0));
        instructions.Add(I(OpCodes.Ldftn, sceneCompleted));
        instructions.Add(I(OpCodes.Newobj, sceneCallbackCtor));
        instructions.Add(I(OpCodes.Ldc_I4_1));
        instructions.Add(I(OpCodes.Ldnull));
        instructions.Add(I(OpCodes.Callvirt, loadScene));
        instructions.Add(I(OpCodes.Stloc, sceneHandle));
        instructions.Add(I(OpCodes.Ldloc, sceneHandle));
        instructions.Add(I(OpCodes.Brfalse_S, retryScene));
        instructions.Add(I(OpCodes.Ldstr, "OFFLINE_YSDT load accepted"));
        instructions.Add(I(OpCodes.Call, debugLog));
        instructions.Add(I(OpCodes.Ret));
        instructions.Add(retryScene);
        instructions.Add(I(OpCodes.Ldstr, "LoadOfflineScene"));
        instructions.Add(Instruction.Create(OpCodes.Ldc_R4, 0.25f));
        instructions.Add(I(OpCodes.Call, invokeDelay));
        instructions.Add(I(OpCodes.Ret));
        download.Methods.Add(loadOfflineScene);
        var collect = new MethodReference("Collect", module.TypeSystem.Void,
            new TypeReference("System", "GC", module, module.TypeSystem.CoreLibrary));
        ReplaceBody(startDownload, new[]
        {
            I(OpCodes.Call, getMono), I(OpCodes.Callvirt, startInit),
            I(OpCodes.Ldstr, "OFFLINE_ENTRY_V2: bundled data initialized"), I(OpCodes.Call, debugLog),
            I(OpCodes.Call, collect),
            I(OpCodes.Ldarg_0), I(OpCodes.Ldstr, "LoadOfflineScene"), Instruction.Create(OpCodes.Ldc_R4, 1.0f),
            I(OpCodes.Call, invokeDelay), I(OpCodes.Ret),
        });
        Changed("Startup: initialize bundled data, retry YSDT while Main is busy, and report scene completion");
        NoOp(GetMethod(download, "CheckOnline"));
        NoOp(GetMethod(download, "CheckWebFile"));
        Changed("Startup: removed online presence and automatic data-update checks");

        var git = GetType(module, "GitFunction");
        PatchLocalTime(module, git, "GetCurrentTime");
        PatchLocalTime(module, git, "GetCurrentWebTime");
        Changed("Completion timers: use the device clock without a time-server request");

        var loading = GetMethod(git, "LoadingComplete");
        var loadLocal = FindRef(module, "PlayerPref", "LoadLocal", 0);
        var gameInstance = GetField(GetType(module, "GameController"), "Instance");
        var initCounts = FindRef(module, "GameController", "InitDefaultCount2", 1);
        var jumpInstance = GetField(GetType(module, "JumpScene"), "Instance");
        var jumpClose = GetMethod(GetType(module, "JumpScene"), "Close");
        var actionCtor = FindRef(module, "System.Action", ".ctor", 2);
        ReplaceBody(loading, new[]
        {
            I(OpCodes.Call, loadLocal), I(OpCodes.Ldsfld, gameInstance), I(OpCodes.Ldsfld, jumpInstance),
            I(OpCodes.Ldftn, jumpClose), I(OpCodes.Newobj, actionCtor),
            I(OpCodes.Callvirt, initCounts), I(OpCodes.Ret),
        });
        Changed("Loading: local save initialization only; no account login or cloud sync timer");

        foreach (string name in new[] { "Login", "RefreshToken", "GetUserData", "GetGistList",
                     "FirstGetGistList", "GetGistSingle", "AutoUpdateGistContent", "UpdateGistContent",
                     "UpdateGistContentWithContent", "UpdateGistSave", "UpdateGistDescription",
                     "DeleteGistFile", "AddGistFile", "AddHistoryGistFile", "AddGistSave" })
            foreach (var method in git.Methods.Where(m => m.Name == name && m.IsPublic)) NoOp(method);
        var syncCallback = GetMethod(git, "AutoUpdateGistContentWithCallBack");
        var invoke = FindRef(module, "System.Action", "Invoke", 0);
        var syncRet = Instruction.Create(OpCodes.Ret);
        ReplaceBody(syncCallback, new[]
        {
            I(OpCodes.Ldarg_1), I(OpCodes.Brfalse_S, syncRet), I(OpCodes.Ldarg_1),
            I(OpCodes.Callvirt, invoke), syncRet,
        });
        var quit = GetMethod(git, "AutoUpdateGistContentWithExit");
        var saveMap = FindRef(module, "PlayerPref", "SaveMapIdel", 0);
        ReplaceBody(quit, new[]
        {
            I(OpCodes.Call, saveMap), I(OpCodes.Ldc_I4_1), I(OpCodes.Ret),
        });
        Changed("Cloud saves: disabled remote entry points; quitting only saves local state");

        PatchLocalIcons(module);
        Changed("Marker icons: load bundled files through the client's native local decoder");

        var popup = GetType(module, "PopupShowHide");
        var iterator = popup.NestedTypes.Single(t => t.Name.Contains("<GetImage>d__"));
        var moveNext = GetMethod(iterator, "MoveNext");
        ReplaceBody(moveNext, new[] { I(OpCodes.Ldc_I4_0), I(OpCodes.Ret) });
        Changed("Marker details: disabled remote comment-image requests; text/details remain native");

        NoOp(GetMethod(GetType(module, "GameController"), "ReCheckVersion"));
        NoOp(GetMethod(GetType(module, "OtherProcess"), "OpenOtherProcess"));
        NoOp(GetMethod(GetType(module, "AutoMapVersion"), "Start"));
        NoOp(GetMethod(GetType(module, "AutoMapVersion"), "CheckUpdate"));
        NoOp(GetMethod(GetType(module, "Notice"), "Start"));
        NoOp(GetMethod(GetType(module, "Notice"), "ReDownloadNotice"));
        NoOp(GetMethod(GetType(module, "Utils"), "SendEvent"));
        NoOp(GetMethod(GetType(module, "Utils"), "SendPageview"));
        Changed("Disabled version checks, companion overlay launch, tracking updates, notices, and analytics");

        var update = GetType(module, "DataUpdate");
        var restart = GetMethod(update, "ReStartUpdate");
        var callbackField = GetField(update, "callback");
        var close = GetMethod(update, "Close");
        ReplaceBody(restart, new[]
        {
            I(OpCodes.Ldarg_0), I(OpCodes.Ldarg_1), I(OpCodes.Stfld, callbackField),
            I(OpCodes.Ldarg_0), I(OpCodes.Call, close), I(OpCodes.Ret),
        });
        Changed("Data-update panel: close locally without starting a download");
    }

    static void PatchLocalTime(ModuleDefinition module, TypeDefinition git, string name)
    {
        var method = GetMethod(git, name);
        var now = FindRef(module, "System.DateTime", "get_Now", 0);
        var invariant = FindRef(module, "System.Globalization.CultureInfo", "get_InvariantCulture", 0);
        var toString = FindRef(module, "System.DateTime", "ToString", 1, "IFormatProvider");
        var invoke = FindRef(module, "System.Action`1<System.String>", "Invoke", 1);
        var ret = Instruction.Create(OpCodes.Ret);
        var currentTime = new VariableDefinition(now.ReturnType);
        ReplaceBody(method, new[]
        {
            I(OpCodes.Ldarg_1), I(OpCodes.Brfalse_S, ret), I(OpCodes.Ldarg_1),
            I(OpCodes.Call, now), I(OpCodes.Stloc, currentTime), I(OpCodes.Ldloca, currentTime),
            I(OpCodes.Call, invariant), I(OpCodes.Call, toString),
            I(OpCodes.Callvirt, invoke), ret,
        });
        method.Body.Variables.Add(currentTime);
        method.Body.InitLocals = true;
    }

    static void PatchLocalIcons(ModuleDefinition module)
    {
        var loadByIo = FindRef(module, "ItemSelect", "LoadByIo", 1);
        var iconMethod = GetMethod(GetType(module, "IconController"), "LoadSprite");
        PatchIconRange(iconMethod, loadByIo, false);
        var poiMethod = GetMethod(GetType(module, "POIObj"), "CheckSpecialIconOverride");
        PatchIconRange(poiMethod, loadByIo, true);
    }

    static void PatchIconRange(MethodDefinition method, MethodReference loadByIo, bool restoreDefault)
    {
        var instructions = method.Body.Instructions;
        int downloadIndex = SingleIndex(instructions, i => i.Operand is MethodReference mr &&
            mr.DeclaringType.FullName == "MyUnityWebRequest" && mr.Name == "DownloadFile");
        int logIndex = SingleIndex(instructions.Take(downloadIndex), i => i.Operand is MethodReference mr &&
            mr.DeclaringType.FullName == "UnityEngine.Debug" && mr.Name == "Log");
        int startIndex = logIndex;
        while (startIndex >= 0 && !(instructions[startIndex].OpCode == OpCodes.Ldsfld &&
               instructions[startIndex].Operand is FieldReference fr && fr.FullName == "System.String AppStatic::AppDataPath"))
            startIndex--;
        if (startIndex < 0) throw new InvalidOperationException($"Icon log prefix not found in {method.FullName}");
        var fields = instructions.Select(i => i.Operand).OfType<FieldReference>()
            .GroupBy(f => f.FullName).Select(g => g.First()).ToArray();
        var iconName = fields.Single(f => f.Name == "iconName");
        var tempSprite = fields.Single(f => f.Name == "tempSprite");
        var replacement = new List<Instruction>
        {
            I(OpCodes.Ldloc_0), I(OpCodes.Ldloc_0), I(OpCodes.Ldfld, iconName),
            I(OpCodes.Call, loadByIo), I(OpCodes.Stfld, tempSprite),
        };
        if (restoreDefault)
        {
            var spriteNames = fields.Single(f => f.Name == "spriteNames" &&
                f.DeclaringType.FullName == iconName.DeclaringType.FullName);
            var getItem = FindRef(method.Module, "System.Collections.Generic.Dictionary`2<System.String,UnityEngine.Sprite>", "get_Item", 1);
            var afterBranch = (Instruction)instructions[downloadIndex + 1].Operand; // common sprite assignment
            replacement.AddRange(new[]
            {
                I(OpCodes.Ldloc_0), I(OpCodes.Ldfld, tempSprite), I(OpCodes.Brtrue_S, afterBranch),
                I(OpCodes.Ldloc_0), I(OpCodes.Ldloc_0), I(OpCodes.Ldfld, spriteNames),
                I(OpCodes.Ldstr, "-1"), I(OpCodes.Callvirt, getItem), I(OpCodes.Stfld, tempSprite),
            });
        }
        ReplaceRange(method, instructions[startIndex], instructions[downloadIndex], replacement);
    }

    static int Dump(string[] args)
    {
        using var assembly = AssemblyDefinition.ReadAssembly(args[1]);
        var type = assembly.MainModule.Types.SelectMany(AllTypes)
            .Single(t => t.FullName == args[2] || t.Name == args[2]);
        foreach (var method in type.Methods.Where(m => m.Name == args[3]))
        {
            Console.WriteLine($"METHOD {method.FullName}");
            if (!method.HasBody) continue;
            for (int i = 0; i < method.Body.Variables.Count; i++)
                Console.WriteLine($"VAR {i}: {method.Body.Variables[i]}");
            foreach (var instruction in method.Body.Instructions)
                Console.WriteLine($"{instruction.Offset:X4}: {instruction}");
        }
        return 0;
    }

    static int Find(string[] args)
    {
        using var assembly = AssemblyDefinition.ReadAssembly(args[1]);
        foreach (var type in assembly.MainModule.Types.SelectMany(AllTypes))
        foreach (var method in type.Methods.Where(m => m.HasBody))
        {
            var instructions = method.Body.Instructions;
            for (int i = 0; i < instructions.Count; i++)
            {
                if (!instructions[i].ToString().Contains(args[2], StringComparison.OrdinalIgnoreCase)) continue;
                Console.WriteLine($"SITE {type.FullName}::{method.Name}");
                for (int j = Math.Max(0, i - 8); j <= Math.Min(instructions.Count - 1, i + 5); j++)
                    Console.WriteLine($"{instructions[j].Offset:X4}: {instructions[j]}");
            }
        }
        return 0;
    }

    static void NoOp(MethodDefinition method)
    {
        if (method.ReturnType.FullName != "System.Void")
            throw new InvalidOperationException($"NoOp requires void: {method.FullName}");
        ReplaceBody(method, new[] { I(OpCodes.Ret) });
    }

    static void ReplaceBody(MethodDefinition method, IEnumerable<Instruction> instructions)
    {
        method.Body.ExceptionHandlers.Clear();
        method.Body.Instructions.Clear();
        method.Body.Variables.Clear();
        method.Body.InitLocals = false;
        foreach (var instruction in instructions) method.Body.Instructions.Add(instruction);
    }

    static void ReplaceRange(MethodDefinition method, Instruction start, Instruction end,
        List<Instruction> replacement)
    {
        if (method.Body.ExceptionHandlers.Count != 0)
            throw new InvalidOperationException($"Range replacement with exception handlers: {method.FullName}");
        var instructions = method.Body.Instructions;
        int first = instructions.IndexOf(start), last = instructions.IndexOf(end);
        if (first < 0 || last < first) throw new InvalidOperationException("Invalid IL replacement range");
        var removed = instructions.Skip(first).Take(last - first + 1).ToHashSet();
        var next = last + 1 < instructions.Count ? instructions[last + 1] : null;
        foreach (var instruction in replacement) method.Body.GetILProcessor().InsertBefore(start, instruction);
        foreach (var instruction in instructions.ToArray())
        {
            if (instruction.Operand is Instruction target && removed.Contains(target))
                instruction.Operand = target == start ? replacement[0] : next ??
                    throw new InvalidOperationException("Branch into removed IL range has no fallthrough");
            if (instruction.Operand is Instruction[] targets)
                for (int i = 0; i < targets.Length; i++)
                    if (removed.Contains(targets[i]))
                        targets[i] = targets[i] == start ? replacement[0] : next ??
                            throw new InvalidOperationException("Switch into removed IL range has no fallthrough");
        }
        for (int i = last + replacement.Count; i >= first + replacement.Count; i--)
            method.Body.GetILProcessor().RemoveAt(i);
    }

    static MethodReference FindRef(ModuleDefinition module, string declaringType, string name,
        int parameters, string? signatureContains = null)
    {
        var matches = module.Types.SelectMany(AllTypes).SelectMany(t => t.Methods)
            .Where(m => m.HasBody).SelectMany(m => m.Body.Instructions)
            .Select(i => i.Operand).OfType<MethodReference>().Where(mr =>
                mr.DeclaringType.FullName == declaringType && mr.Name == name &&
                mr.Parameters.Count == parameters &&
                (signatureContains == null || mr.FullName.Contains(signatureContains)))
            .GroupBy(mr => mr.FullName).Select(g => g.First()).ToArray();
        if (matches.Length != 1)
            throw new InvalidOperationException($"Expected one method reference {declaringType}::{name}/{parameters} {signatureContains}, found {matches.Length}: {string.Join(" | ", matches.Select(m => m.FullName))}");
        return matches[0];
    }

    static MethodReference Clone(MethodReference method)
    {
        return new MethodReference(method.Name, method.ReturnType, method.DeclaringType)
        {
            HasThis = method.HasThis, ExplicitThis = method.ExplicitThis,
            CallingConvention = method.CallingConvention,
        };
    }

    static TypeDefinition GetType(ModuleDefinition module, string fullName) =>
        module.Types.SelectMany(AllTypes).Single(t => t.FullName == fullName);

    static MethodDefinition GetMethod(TypeDefinition type, string name) =>
        type.Methods.Single(m => m.Name == name);

    static FieldDefinition GetField(TypeDefinition type, string name) =>
        type.Fields.Single(f => f.Name == name);

    static T Single<T>(IEnumerable<T> source, Func<T, bool> predicate) => source.Single(predicate);

    static int SingleIndex<T>(IEnumerable<T> source, Func<T, bool> predicate)
    {
        int found = -1, index = 0;
        foreach (var item in source)
        {
            if (predicate(item))
            {
                if (found >= 0) throw new InvalidOperationException("Expected one IL instruction, found several");
                found = index;
            }
            index++;
        }
        if (found < 0) throw new InvalidOperationException("Expected IL instruction was not found");
        return found;
    }

    static Instruction I(OpCode op) => Instruction.Create(op);
    static Instruction I(OpCode op, string value) => Instruction.Create(op, value);
    static Instruction I(OpCode op, sbyte value) => Instruction.Create(op, value);
    static Instruction I(OpCode op, ParameterDefinition value) => Instruction.Create(op, value);
    static Instruction I(OpCode op, VariableDefinition value) => Instruction.Create(op, value);
    static Instruction I(OpCode op, FieldReference value) => Instruction.Create(op, value);
    static Instruction I(OpCode op, MethodReference value) => Instruction.Create(op, value);
    static Instruction I(OpCode op, Instruction value) => Instruction.Create(op, value);
    static void Changed(string text) => Changes.Add(text);

    static IEnumerable<TypeDefinition> AllTypes(TypeDefinition type)
    {
        yield return type;
        foreach (var nested in type.NestedTypes.SelectMany(AllTypes)) yield return nested;
    }
}
