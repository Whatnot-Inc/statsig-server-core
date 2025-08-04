﻿using System.Reflection;
using Statsig;

class Program
{
    static async Task Main()
    {
        string infoVersion =
            typeof(Statsig.Statsig).Assembly
                .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
                .InformationalVersion ?? "(n/a)";
        Console.WriteLine($"InformationalVersion → {infoVersion}");
        string sdkKey = Environment.GetEnvironmentVariable("STATSIG_SERVER_SDK_KEY")
                        ?? throw new InvalidOperationException("STATSIG_SERVER_SDK_KEY is not set");
        using var statsig = new Statsig.Statsig(sdkKey, new StatsigOptions(new StatsigOptionsBuilder()));

        await statsig.Initialize();

        var user = new StatsigUserBuilder().SetUserID("verify_user").Build();
        bool gate  = statsig.CheckGate(user, "test_public");

        Console.WriteLine($"gate 'test_public': {gate}");

        await statsig.Shutdown();
    }
}
