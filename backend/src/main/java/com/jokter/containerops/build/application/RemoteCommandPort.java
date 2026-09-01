package com.jokter.containerops.build.application;

import java.util.function.Consumer;

public interface RemoteCommandPort {
    RemoteCommandResult execute(RemoteTarget target, String command, Consumer<String> output);
}
