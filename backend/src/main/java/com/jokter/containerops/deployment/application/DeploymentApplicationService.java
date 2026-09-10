package com.jokter.containerops.deployment.application;

import com.jokter.containerops.deployment.domain.model.DeploymentTask;
import org.springframework.stereotype.Service;

@Service
public final class DeploymentApplicationService {
    private final DeploymentWorkflow workflow;

    public DeploymentApplicationService(DeploymentWorkflow workflow) {
        this.workflow = workflow;
    }

    public DeploymentCandidates candidates(Long artifactId, Long environmentId, String namespace) {
        return workflow.candidates(artifactId, environmentId, namespace);
    }

    public DeploymentTask create(CreateDeploymentTaskCommand command) {
        return workflow.start(command);
    }

    public DeploymentTask get(String id) {
        return workflow.get(id);
    }

    public void updateValues(String id, String service, String values) {
        workflow.updateValues(id, service, values);
    }

    public DeploymentTask execute(String id, long expectedRevision) {
        return workflow.continueAfterReview(id, expectedRevision);
    }
}
