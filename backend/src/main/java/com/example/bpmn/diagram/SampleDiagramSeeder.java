package com.example.bpmn.diagram;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.core.io.support.ResourcePatternResolver;
import org.springframework.stereotype.Component;
import org.springframework.util.StreamUtils;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Objects;

@Component
@ConditionalOnProperty(name = "app.seed.enabled", havingValue = "true", matchIfMissing = true)
class SampleDiagramSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(SampleDiagramSeeder.class);
    private static final String LOCATION = "classpath:sample-diagrams/*.bpmn";

    private final DiagramRepository repository;
    private final ResourcePatternResolver resolver;

    SampleDiagramSeeder(DiagramRepository repository) {
        this.repository = repository;
        this.resolver = new PathMatchingResourcePatternResolver();
    }

    @Override
    public void run(ApplicationArguments args) throws IOException {
        if (repository.count() > 0) {
            log.info("Diagrams already present — skipping sample seed");
            return;
        }
        Resource[] resources = resolver.getResources(LOCATION);
        Arrays.sort(resources, Comparator.comparing(r -> Objects.requireNonNull(r.getFilename())));
        for (Resource r : resources) {
            String filename = Objects.requireNonNull(r.getFilename());
            String xml = StreamUtils.copyToString(r.getInputStream(), StandardCharsets.UTF_8);
            Diagram d = new Diagram();
            d.setName(humanize(filename));
            d.setXml(xml);
            repository.save(d);
        }
        log.info("Seeded {} sample diagrams", resources.length);
    }

    static String humanize(String filename) {
        String base = filename.replaceFirst("\\.bpmn$", "").replaceFirst("^\\d+-", "");
        String spaced = base.replace('-', ' ').replace('_', ' ');
        if (spaced.isEmpty()) {
            return filename;
        }
        return Character.toUpperCase(spaced.charAt(0)) + spaced.substring(1);
    }
}
