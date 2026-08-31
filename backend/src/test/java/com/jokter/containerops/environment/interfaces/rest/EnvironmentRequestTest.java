package com.jokter.containerops.environment.interfaces.rest;

import com.jokter.containerops.environment.domain.model.EnvironmentType;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class EnvironmentRequestTest {
    @Test
    void acceptsCompleteBusinessAndManagementPlaneUrls() {
        EnvironmentRequest request = request(
                "https://141.71.43.65:31943",
                "business-user",
                "business-password",
                "https://141.71.43.62:31945",
                "management-user",
                "management-password"
        );

        assertThat(request.isBusinessPlaneValid()).isTrue();
        assertThat(request.isManagementPlaneValid()).isTrue();
    }

    @Test
    void rejectsIncompleteOrNonHttpPlaneConfiguration() {
        EnvironmentRequest request = request(
                "141.71.43.65:31943",
                "business-user",
                "business-password",
                "https://141.71.43.62:31945",
                null,
                "management-password"
        );

        assertThat(request.isBusinessPlaneValid()).isFalse();
        assertThat(request.isManagementPlaneValid()).isFalse();
    }

    private EnvironmentRequest request(
            String businessPlaneUrl,
            String businessPlaneUser,
            String businessPlanePassword,
            String managementPlaneUrl,
            String managementPlaneUser,
            String managementPlanePassword
    ) {
        return new EnvironmentRequest(
                1L,
                EnvironmentType.CONTAINER,
                "容器环境",
                "10.0.0.1",
                22,
                "sop-password",
                "root-password",
                "/opt/runtime",
                "X86_64",
                businessPlaneUrl,
                businessPlaneUser,
                businessPlanePassword,
                managementPlaneUrl,
                managementPlaneUser,
                managementPlanePassword,
                null
        );
    }
}
