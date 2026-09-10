package com.jokter.containerops.deployment.infrastructure.runtime;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import com.jokter.containerops.deployment.domain.model.DeploymentTask;
import com.jokter.containerops.deployment.domain.model.DeploymentMode;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class InMemoryDeploymentTaskStoreTest {
    @Test
    void eventSequenceRemainsMonotonicAfterRetentionLimit() {
        InMemoryDeploymentTaskStore store = new InMemoryDeploymentTaskStore(2);
        DeploymentTask task = DeploymentTask.create(
                "task-1", DeploymentMode.REVIEW, 1L, 2L, "mae-fmemate", "default", List.of("service-a"));
        store.create(task);

        for (int index = 0; index < 3; index++) {
            store.emit("task-1", "ANALYZE", "service-a", "事件 " + index);
        }
        store.emit("task-1", "ANALYZE", "service-a", "最终事件");

        assertThat(store.events("task-1")).hasSize(2);
        assertThat(store.events("task-1").get(1).sequence()).isEqualTo(4L);
    }

    @Test
    void writesDeploymentEventsToApplicationLog() {
        Logger logger = (Logger) LoggerFactory.getLogger(InMemoryDeploymentTaskStore.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        logger.addAppender(appender);
        try {
            InMemoryDeploymentTaskStore store = new InMemoryDeploymentTaskStore();
            DeploymentTask preparation = DeploymentTask.create(
                    "preparation-1", DeploymentMode.REVIEW, 1L, 2L, "mae-fmemate", "default", List.of("fmproductfrontendservice"));
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
