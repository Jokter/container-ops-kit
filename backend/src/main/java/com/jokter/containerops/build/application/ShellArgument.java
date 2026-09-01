package com.jokter.containerops.build.application;

public final class ShellArgument {
    private ShellArgument() {
    }

    public static String quote(String value) {
        return "'" + value.replace("'", "'\"'\"'") + "'";
    }
}
