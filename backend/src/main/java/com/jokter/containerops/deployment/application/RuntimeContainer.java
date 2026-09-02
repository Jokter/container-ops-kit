package com.jokter.containerops.deployment.application;

record RuntimeContainer(String pod, String container, String phase, boolean ready, String image) {
}
