package com.jokter.containerops.containerresource.interfaces.rest;

import com.jokter.containerops.ContainerOpsKitApplication;
import com.jokter.containerops.containerresource.application.ContainerResourceRemotePort;
import com.jokter.containerops.containerresource.domain.model.ResourceGroupSummary;
import com.jokter.containerops.containerresource.domain.model.ResourceGroupType;
import com.jokter.containerops.containerresource.domain.model.ResourceTypeSummary;
import com.jokter.containerops.containerresource.domain.model.ResourceSummary;
import com.jokter.containerops.containerresource.domain.model.ServiceResources;
import com.jokter.containerops.containerresource.domain.model.EditableResource;
import com.jokter.containerops.containerresource.domain.model.ResourceCoordinates;
import com.jokter.containerops.containerresource.domain.model.ServiceResourceWorkspace;
import com.jokter.containerops.containerresource.domain.model.ServiceSummary;
import com.jokter.containerops.containerresource.domain.model.ServiceSource;
import com.jokter.containerops.containerresource.domain.model.ResourceChangePreview;
import com.jokter.containerops.containerresource.domain.model.ResourceChangeResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;

import java.util.List;
import java.util.Set;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest(
        classes = ContainerOpsKitApplication.class,
        properties = "spring.datasource.url=jdbc:h2:mem:container-resource-services;DB_CLOSE_DELAY=-1"
)
@AutoConfigureMockMvc
class ContainerResourceServicesEndpointTest {
    @Autowired
    private MockMvc mvc;

    @Autowired
    private JdbcTemplate jdbc;

    @MockBean
    private ContainerResourceRemotePort remote;

    @BeforeEach
    void setUp() {
        jdbc.update("delete from environment where id = 901");
        jdbc.update("insert into environment(id, release_version_id, type, name, host, ssh_port, password, root_password, work_directory, architecture, connection_status, created_at, updated_at, version) values (901, 1, 'CONTAINER', 'Ubuntu K3s 开发环境', '127.0.0.1', 22, 'sop-password', 'root-password', '/data/container-ops', 'x86_64', 'REACHABLE', current_timestamp, current_timestamp, 0)");
        when(remote.loadServices(any(), eq("mae"), eq(false))).thenReturn(new ServiceResourceWorkspace(
                901L,
                "Ubuntu K3s 开发环境",
                "mae",
                List.of(new ServiceSummary("helm:demo-service", "demo-service", ServiceSource.HELM_RELEASE, "NORMAL", 9)),
                List.of(
                        new ResourceGroupSummary(ResourceGroupType.SHARED, "公共资源", 12),
                        new ResourceGroupSummary(ResourceGroupType.UNASSIGNED, "未归属资源", 3),
                        new ResourceGroupSummary(ResourceGroupType.CLUSTER, "集群级资源", 24)
                )
        ));
    }

    @Test
    void listsServicesAndSpecialGroupsByContainerEnvironmentAndNamespace() throws Exception {
        mvc.perform(get("/api/container-resource-services")
                        .param("environmentId", "901")
                        .param("namespace", "mae"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.environmentName").value("Ubuntu K3s 开发环境"))
                .andExpect(jsonPath("$.namespace").value("mae"))
                .andExpect(jsonPath("$.services[0].key").value("helm:demo-service"))
                .andExpect(jsonPath("$.services[0].source").value("HELM_RELEASE"))
                .andExpect(jsonPath("$.services[0].resourceCount").value(9))
                .andExpect(jsonPath("$.groups[0].type").value("SHARED"))
                .andExpect(jsonPath("$.groups[1].type").value("UNASSIGNED"))
                .andExpect(jsonPath("$.groups[2].type").value("CLUSTER"));
    }

    @Test
    void listsBuiltInAndCustomResourceTypesFromDiscovery() throws Exception {
        when(remote.loadResourceTypes(any(), eq(false))).thenReturn(List.of(
                new ResourceTypeSummary("apps", "v1", "deployments", "Deployment", true, Set.of("get", "list", "update", "patch"), true, false),
                new ResourceTypeSummary("resource.sop.huawei.com", "v1", "resourceclaims", "ResourceClaim", true, Set.of("create", "get", "list", "update", "patch"), true, true)
        ));

        mvc.perform(get("/api/container-resource-types")
                        .param("environmentId", "901"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].group").value("apps"))
                .andExpect(jsonPath("$[0].resource").value("deployments"))
                .andExpect(jsonPath("$[0].custom").value(false))
                .andExpect(jsonPath("$[1].group").value("resource.sop.huawei.com"))
                .andExpect(jsonPath("$[1].kind").value("ResourceClaim"))
                .andExpect(jsonPath("$[1].verbs[0]").value("create"))
                .andExpect(jsonPath("$[1].schemaAvailable").value(true))
                .andExpect(jsonPath("$[1].custom").value(true));
    }

    @Test
    void listsResourcesBelongingToSelectedService() throws Exception {
        when(remote.loadServiceResources(any(), eq("mae"), eq("helm:demo-service"))).thenReturn(new ServiceResources(
                "helm:demo-service",
                "demo-service",
                List.of(
                        new ResourceSummary("apps", "v1", "deployments", "Deployment", "demo-service", "WORKLOAD", "3/3", false, true),
                        new ResourceSummary("", "v1", "configmaps", "ConfigMap", "demo-service-config", "CONFIGURATION", "ACTIVE", false, true),
                        new ResourceSummary("resource.sop.huawei.com", "v1", "resourceclaims", "ResourceClaim", "demo-service-resource", "CUSTOM", "READY", true, true)
                )
        ));

        mvc.perform(get("/api/container-service-resources")
                        .param("environmentId", "901")
                        .param("namespace", "mae")
                        .param("serviceKey", "helm:demo-service"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.serviceName").value("demo-service"))
                .andExpect(jsonPath("$.resources[0].category").value("WORKLOAD"))
                .andExpect(jsonPath("$.resources[1].resource").value("configmaps"))
                .andExpect(jsonPath("$.resources[2].group").value("resource.sop.huawei.com"))
                .andExpect(jsonPath("$.resources[2].custom").value(true));
    }

    @Test
    void readsEditableYamlFromLiveResource() throws Exception {
        ResourceCoordinates coordinates = new ResourceCoordinates("resource.sop.huawei.com", "v1", "resourceclaims", "mae", "demo-service-resource");
        when(remote.readResource(any(), eq(coordinates))).thenReturn(new EditableResource(
                coordinates,
                "apiVersion: resource.sop.huawei.com/v1\nkind: ResourceClaim\nmetadata:\n  name: demo-service-resource\n  resourceVersion: \"184729\"\n",
                "184729",
                true
        ));

        mvc.perform(get("/api/container-resources")
                        .param("environmentId", "901")
                        .param("namespace", "mae")
                        .param("group", "resource.sop.huawei.com")
                        .param("version", "v1")
                        .param("resource", "resourceclaims")
                        .param("name", "demo-service-resource"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.coordinates.resource").value("resourceclaims"))
                .andExpect(jsonPath("$.yaml").value(org.hamcrest.Matchers.containsString("kind: ResourceClaim")))
                .andExpect(jsonPath("$.resourceVersion").value("184729"))
                .andExpect(jsonPath("$.managedByHelm").value(true));
    }

    @Test
    void previewsAndAppliesResourceUpdate() throws Exception {
        ResourceCoordinates coordinates = new ResourceCoordinates("apps", "v1", "deployments", "mae", "demo-service");
        when(remote.previewUpdate(any(), eq(coordinates), eq("updated-yaml"), eq("184729"))).thenReturn(
                new ResourceChangePreview(true, "- replicas: 2\n+ replicas: 3", "184729", List.of("该资源由 Helm 管理"))
        );
        when(remote.applyUpdate(any(), eq(coordinates), eq("updated-yaml"), eq("184729"))).thenReturn(
                new ResourceChangeResult(coordinates, "184730", "updated-yaml")
        );

        String request = """
                {
                  "environmentId": 901,
                  "coordinates": {
                    "group": "apps",
                    "version": "v1",
                    "resource": "deployments",
                    "namespace": "mae",
                    "name": "demo-service"
                  },
                  "yaml": "updated-yaml",
                  "expectedResourceVersion": "184729"
                }
                """;

        mvc.perform(post("/api/container-resource-changes/preview")
                        .contentType("application/json")
                        .content(request))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.valid").value(true))
                .andExpect(jsonPath("$.diff").value(org.hamcrest.Matchers.containsString("replicas: 3")))
                .andExpect(jsonPath("$.warnings[0]").value("该资源由 Helm 管理"));

        mvc.perform(post("/api/container-resource-changes/apply")
                        .contentType("application/json")
                        .content(request))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.resourceVersion").value("184730"));
    }

    @Test
    void previewsAndCreatesResourceForService() throws Exception {
        ResourceCoordinates coordinates = new ResourceCoordinates("", "v1", "configmaps", "mae", "demo-service-extra");
        when(remote.previewCreate(any(), eq("mae"), eq("helm:demo-service"), eq("new-yaml"))).thenReturn(
                new ResourceChangePreview(true, "+ kind: ConfigMap", null, List.of())
        );
        when(remote.createResource(any(), eq("mae"), eq("helm:demo-service"), eq("new-yaml"))).thenReturn(
                new ResourceChangeResult(coordinates, "184731", "new-yaml")
        );

        String request = """
                {
                  "environmentId": 901,
                  "namespace": "mae",
                  "serviceKey": "helm:demo-service",
                  "yaml": "new-yaml"
                }
                """;

        mvc.perform(post("/api/container-resources/preview")
                        .contentType("application/json")
                        .content(request))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.valid").value(true));

        mvc.perform(post("/api/container-resources")
                        .contentType("application/json")
                        .content(request))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.coordinates.name").value("demo-service-extra"));
    }
}
