package com.jokter.containerops.deployment.infrastructure.runtime;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.jokter.containerops.deployment.domain.model.DeploymentPreparation;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class InMemoryDeploymentPreparationStoreTest {
    @Test
    void writesDeploymentEventsToApplicationLog() {
        Logger logger = (Logger) LoggerFactory.getLogger(InMemoryDeploymentPreparationStore.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            InMemoryDeploymentPreparationStore store = new InMemoryDeploymentPreparationStore();
            DeploymentPreparation preparation = DeploymentPreparation.create(
                    "preparation-1", 1L, 2L, "mae-fmemate", "default", List.of("fmproductfrontendservice"));
            store.create(preparation);

            store.emit("preparation-1", "ANALYZE", "fmproductfrontendservice", "存在未解析占位符");

            assertThat(appender.list)
                    .extracting(ILoggingEvent::getFormattedMessage)
                    .containsExactly("deploymentId=preparation-1 stage=ANALYZE service=fmproductfrontendservice message=存在未解析占位符");
        } finally {
            logger.detachAppender(appender);
            appender.stop();
        }
    }
}
