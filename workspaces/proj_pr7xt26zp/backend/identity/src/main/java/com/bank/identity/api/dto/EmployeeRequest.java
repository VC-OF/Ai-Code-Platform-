package com.bank.identity.api.dto;

import com.bank.identity.domain.Employee;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.time.LocalDate;
import java.util.UUID;

public record EmployeeRequest(
        @NotNull UUID userId,
        @NotBlank @Size(max = 32) String employeeCode,
        @NotBlank @Size(max = 64) String firstName,
        @NotBlank @Size(max = 64) String lastName,
        @Size(max = 64) String designation,
        @Size(max = 64) String department,
        @NotNull LocalDate dateOfJoining,
        @Size(max = 16) String employmentType,
        UUID managerId,
        UUID branchId,
        long salaryAmountMinor,
        @NotBlank @Size(min = 3, max = 3) String salaryCurrency
) {
    public Employee toEntity(UUID tenantId) {
        Employee e = new Employee();
        e.setTenantId(tenantId);
        e.setUserId(userId);
        e.setEmployeeCode(employeeCode);
        e.setFirstName(firstName);
        e.setLastName(lastName);
        e.setDesignation(designation);
        e.setDepartment(department);
        e.setDateOfJoining(dateOfJoining);
        e.setEmploymentType(employmentType == null ? "FULL_TIME" : employmentType);
        e.setManagerId(managerId);
        e.setBranchId(branchId);
        e.setSalaryAmountMinor(salaryAmountMinor);
        e.setSalaryCurrency(salaryCurrency);
        e.setStatus("ACTIVE");
        return e;
    }
}
