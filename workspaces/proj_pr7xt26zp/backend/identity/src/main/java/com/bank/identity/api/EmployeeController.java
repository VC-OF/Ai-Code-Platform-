package com.bank.identity.api;

import com.bank.identity.api.dto.EmployeeRequest;
import com.bank.identity.api.dto.EmployeeResponse;
import com.bank.identity.service.EmployeeService;
import com.bank.platform.api.dto.PageRequest;
import com.bank.platform.api.dto.PageResponse;
import com.bank.platform.security.AuthorizationService;
import com.bank.platform.security.CurrentUser;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.data.domain.Page;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.net.URI;
import java.util.UUID;

@RestController
@RequestMapping("/api/v1/employees")
@Tag(name = "Employees", description = "Employee management endpoints")
public class EmployeeController {

    private final EmployeeService employees;
    private final AuthorizationService authz;
    private final CurrentUser currentUser;

    public EmployeeController(EmployeeService employees, AuthorizationService authz, CurrentUser currentUser) {
        this.employees = employees;
        this.authz = authz;
        this.currentUser = currentUser;
    }

    @GetMapping
    @Operation(summary = "List employees")
    public PageResponse<EmployeeResponse> list(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            @RequestParam(defaultValue = "createdAt") String sortBy,
            @RequestParam(defaultValue = "asc") String sortDir,
            @RequestParam(required = false) String q) {
        authz.requirePermission("employee.read");
        var user = currentUser.require();
        PageRequest req = new PageRequest(page, size, sortBy, sortDir, q);
        Page<com.bank.identity.domain.Employee> p = employees.list(
            user.getTenantId(), q, req.toSpringPageRequest());
        return new PageResponse<>(
            p.getContent().stream().map(EmployeeResponse::from).toList(),
            p.getTotalElements(), p.getTotalPages(), p.getNumber(), p.getSize(),
            p.hasNext(), p.hasPrevious(),
            new PageResponse.Sort(sortBy, sortDir.toUpperCase())
        );
    }

    @GetMapping("/{id}")
    @Operation(summary = "Get employee by id")
    public EmployeeResponse get(@PathVariable UUID id) {
        authz.requirePermission("employee.read");
        return EmployeeResponse.from(employees.get(id));
    }

    @PostMapping
    @Operation(summary = "Create employee")
    public ResponseEntity<EmployeeResponse> create(@Valid @RequestBody EmployeeRequest req) {
        authz.requirePermission("employee.create");
        var user = currentUser.require();
        var saved = employees.create(req.toEntity(user.getTenantId()));
        return ResponseEntity.created(URI.create("/api/v1/employees/" + saved.getId()))
            .body(EmployeeResponse.from(saved));
    }

    @PutMapping("/{id}")
    @Operation(summary = "Update employee")
    public EmployeeResponse update(@PathVariable UUID id, @Valid @RequestBody EmployeeRequest req) {
        authz.requirePermission("employee.update");
        return EmployeeResponse.from(employees.update(id, req.toEntity(currentUser.require().getTenantId())));
    }
}
