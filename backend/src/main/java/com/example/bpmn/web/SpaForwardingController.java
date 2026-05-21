package com.example.bpmn.web;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class SpaForwardingController {

    @GetMapping(value = {
            "/",
            "/diagrams",
            "/diagrams/**"
    })
    public String forward() {
        return "forward:/index.html";
    }
}
