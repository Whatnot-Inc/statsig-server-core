package com.statsig;

import java.io.*;
import java.net.URL;
import java.util.Map;

class StatsigJNI {
    private static final boolean libraryLoaded;
    private static final String logContext = "com.statsig.StatsigJNI";

    static boolean isLibraryLoaded() {
        return libraryLoaded;
    }

    static {
        String osName = System.getProperty("os.name").toLowerCase();
        String osArch = System.getProperty("os.arch").toLowerCase();

        OutputLogger.logInfo(logContext, "Detected OS: " + osName + " Arch: " + osArch);

        libraryLoaded = loadNativeLibrary(osName, osArch);

        if (!libraryLoaded) {
            logNativeLibraryError(osName, osArch);
        }
    }

    /**
     * Statsig
     */
    public static native String statsigCreate(String sdkKey, String optionsRef);

    public static native void statsigRelease(String statsigRef);

    public static native void statsigInitialize(String statsigRef, Runnable callback);

    public static native void statsigShutdown(String statsigRef, Runnable callback);

    public static native boolean statsigCheckGate(String statsigRef, String userRef, String gateName);

    public static native String statsigGetFeatureGate(String statsigRef, String userRef, String gateName);

    public static native String statsigGetLayer(String statsigRef, String userRef, String layerName);

    public static native String statsigGetExperiment(String statsigRef, String userRef, String experimentName);

    public static native String statsigGetDynamicConfig(String statsigRef, String userRef, String configName);

    public static native String statsigGetClientInitResponse(String statsigRef, String userRef);

    public static native void statsigLogEvent(String statsigRef, String userRef, String eventName, String value,
            Map<String, String> metadata);

    public static native void statsigFlushEvents(String statsigRef, Runnable callback);

    /**
     * StatsigUser
     */
    public static native String statsigUserCreate(
            String userId,
            String customIdsJson,
            String email,
            String ip,
            String userAgent,
            String country,
            String locale,
            String appVersion,
            String customJson,
            String privateAttributesJson);

    public static native void statsigUserRelease(String userRef);

    /**
     * StatsigOptions
     */
    public static native String statsigOptionsCreate(
            String specsUrl,
            String logEventUrl,
            long specsSyncIntervalMs,
            long eventLoggingFlushIntervalMs,
            long eventLoggingMaxQueueSize,
            String environment,
            long outputLoggerLevel);

    public static native void statsigOptionsRelease(String optionsRef);


    /**
     * [Internal] Library Loading
     */

    private static boolean loadNativeLibrary(String osName, String osArch) {
        try {
            URL resource = findLibraryResource(osName, osArch);

            if (resource == null) {
                OutputLogger.logError(
                        logContext,
                        "Unable to find native library resource for OS: " + osName + " Arch: " + osArch);
                return false;
            }

            OutputLogger.logInfo(
                    logContext,
                    "Loading native library: " + resource);
            String libPath = writeLibToTempFile(resource);

            if (libPath == null) {
                return false;
            }

            OutputLogger.logInfo(
                    logContext,
                    "Loaded native library: " + libPath);
            System.load(libPath);

            return true;
        } catch (UnsatisfiedLinkError e) {
            OutputLogger.logError(
                    logContext,
                    String.format("Error: Native library not found for the specific OS and architecture. " +
                            "Operating System: %s, Architecture: %s. Please ensure that the necessary dependencies have been added to your project configuration.\n",
                            osName, osArch));
            return false;
        }
    }

    private static String writeLibToTempFile(URL resource) {
        try {
            InputStream stream = resource.openStream();

            if (stream == null) {
                OutputLogger.logError(logContext, "Unable to open stream for resource: " + resource);
                return null;
            }

            File temp = File.createTempFile("statsig_ffi_lib", null);
            temp.deleteOnExit();

            try (stream; OutputStream out = new FileOutputStream(temp)) {
                byte[] buffer = new byte[1024];
                int length = 0;
                while ((length = stream.read(buffer)) != -1) {
                    out.write(buffer, 0, length);
                }
            }

            OutputLogger.logInfo(logContext,
                    "Successfully created a temporary file for the native library at: " + temp.getAbsolutePath());
            return temp.getAbsolutePath();
        } catch (IOException e) {
            OutputLogger.logError(logContext,
                    "I/O Error while writing the library to a temporary file: " + e.getMessage());
            return null;
        }
    }

    private static URL findLibraryResource(String osName, String osArch) {
        ClassLoader cl = StatsigJNI.class.getClassLoader();
        URL resource = null;

        if (osName.contains("win")) {
            if (osArch.equals("x86_64") || osArch.equals("i686") || osArch.equals("aarch64")) {
                resource = cl.getResource("native/libstatsig_ffi.dll");
            }
        } else if (osName.contains("mac")) {
            if (osArch.equals("x86_64") || osArch.equals("amd64") || osArch.equals("aarch64")) {
                resource = cl.getResource("native/libstatsig_ffi.dylib");
            }
        } else if (osName.contains("linux")) {
            if (osArch.equals("x86_64") || osArch.equals("arm64")) {
                resource = cl.getResource("native/libstatsig_ffi.so");
            }
        }

        return resource;
    }

    private static void logNativeLibraryError(String osName, String osArch) {
        StringBuilder message = new StringBuilder("Ensure the correct native library is available for your platform.\n");
        String normalizedOsName = osName.toLowerCase().replace(" ", "");
        String arch = osArch.contains("aarch64") ? "arm64" : osArch.contains("x86_64") ? "x86_64" : osArch;
    
        if (normalizedOsName.contains("macos")) {
            addDependency(message, "macOS", arch, "macos");
        } else if (normalizedOsName.contains("linux")) {
            addDependency(message, "Linux", arch, "amazonlinux2", "amazonlinux2023");
        } else if (normalizedOsName.contains("win")) {
            addDependency(message, "Windows", arch, "windows");
        } else {
            message.append(String.format("Unsupported OS: %s. Check your environment.\n", osName));
        }
    
        message.append("For further assistance, refer to the documentation or contact support.");
        OutputLogger.logError(logContext, message.toString());
    }
    
    private static void addDependency(StringBuilder message, String os, String arch, String... platforms) {
        message.append(String.format("For %s with %s architecture, add the following to build.gradle:\n", os, arch));
        for (String platform : platforms) {
            message.append(String.format("  implementation 'com.statsig:serversdk-test:<version>:%s-%s'\n", platform, arch));
        }
    }

}
