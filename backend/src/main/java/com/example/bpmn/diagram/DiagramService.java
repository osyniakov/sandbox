package com.example.bpmn.diagram;

import com.example.bpmn.diagram.dto.DiagramRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@Transactional
public class DiagramService {

    private final DiagramRepository repository;

    public DiagramService(DiagramRepository repository) {
        this.repository = repository;
    }

    @Transactional(readOnly = true)
    public List<Diagram> findAll() {
        return repository.findAll();
    }

    @Transactional(readOnly = true)
    public Diagram findById(Long id) {
        return repository.findById(id)
                .orElseThrow(() -> new DiagramNotFoundException(id));
    }

    public Diagram create(DiagramRequest request) {
        Diagram d = new Diagram();
        d.setName(request.name());
        d.setXml(request.xml());
        return repository.save(d);
    }

    public Diagram update(Long id, DiagramRequest request) {
        Diagram d = findById(id);
        d.setName(request.name());
        d.setXml(request.xml());
        return repository.save(d);
    }

    public void delete(Long id) {
        if (!repository.existsById(id)) {
            throw new DiagramNotFoundException(id);
        }
        repository.deleteById(id);
    }
}
