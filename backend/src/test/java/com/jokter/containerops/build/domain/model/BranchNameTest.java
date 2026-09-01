package com.jokter.containerops.build.domain.model;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class BranchNameTest {
    @Test
    void usesMasterWhenTheInputIsBlank() {
        assertThat(BranchName.of(" ").value()).isEqualTo("master");
    }

    @Test
    void acceptsCommonGitBranchNames() {
        assertThat(BranchName.of("feature/build_27.1").value()).isEqualTo("feature/build_27.1");
    }

    @Test
    void rejectsValuesThatCouldChangeTheRemoteCommand() {
        assertThatThrownBy(() -> BranchName.of("master; rm -rf data"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("分支名称格式不正确");
    }
}
