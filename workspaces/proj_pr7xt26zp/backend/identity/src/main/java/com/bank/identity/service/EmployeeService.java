package com.bank.identity.service;

import com.bank.identity.domain.Employee;
import com.bank.identity.repository.EmployeeRepository;
import com.bank.platform.audit.AuditService;
import com.bank.platform.web.error.ConflictException;
import com.bank.platform.web.error.NotFoundException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
public class EmployeeService {

    private final EmployeeRepository employees;
    private final AuditService audit;

    public EmployeeService(EmployeeRepository employees, AuditService audit) {
        this.employees = employees;
        this.audit = audit;
    }

    @Transactional
    public Employee create(Employee employee) {
        if (employees.findByUserId(employee.getUserId()).isPresent()) {
            throw new ConflictException("EMPLOYEE_DUPLICATE_USER", "User already linked to an employee");
        }
        if (employees.findByTenantIdAndEmployeeCode(employee.getTenantId(), employee.getEmployeeCode()).isPresent()) {
            throw new ConflictException("EMPLOYEE_DUPLICATE_CODE", "Employee code already exists");
        }
        employee.newId();
        Employee saved = employees.save(employee);
        audit.recordAction(null, "employee.create",
            "Created employee " + saved.getId() + " (" + saved.getEmployeeCode() + ")");
        return saved;
    }

    @Transactional
    public Employee update(UUID id, Employee update) {
        Employee e = get(id);
        e.setFirstName(update.getFirstName());
        e.setLastName(update.getLastName());
        e.setDesignation(update.getDesignation());
        e.setDepartment(update.getDepartment());
        e.setEmploymentType(update.getEmploymentType());
        e.setManagerId(update.getManagerId());
        e.setSalaryAmountMinor(update.getSalaryAmountMinor());
        e.setSalaryCurrency(update.getSalaryCurrency());
        e.setBranchId(update.getBranchId());
        e.setStatus(update.getStatus());
        return employees.save(e);
    }

    @Transactional(readOnly = true)
    public Employee get(UUID id) {
        return employees.findById(id)
            .orElseThrow(() -> new NotFoundException("EMPLOYEE_NOT_FOUND", "Employee " + id + " not found"));
    }

    @Transactional(readOnly = true)
    public Page<Employee> list(UUID tenantId, String q, Pageable pageable) {
        return (q == null || q.isBlank())
            ? employees.findByTenantId(tenantId, pageable)
            : employees.search(tenantId, q, pageable);
    }
}
