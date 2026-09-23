package com.bank.identity.api.dto;

import com.bank.identity.domain.Employee;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

public record EmployeeResponse(
        UUID id,
        UUID tenantId,
        UUID userId,
        UUID branchId,
        String employeeCode,
        String firstName,
        String lastName,
        String designation,
        String department,
        LocalDate dateOfJoining,
        String employmentType,
        UUID managerId,
        long salaryAmountMinor,
        String salaryCurrency,
        String status,
        Instant createdAt
) {
    public static EmployeeResponse from(Employee e) {
        return new EmployeeResponse(
            e.getId(), e.getTenantId(), e.getUserId(), e.getBranchId(),
            e.getEmployeeCode(), e.getFirstName(), e.getLastName(),
            e.getDesignation(), e.getDepartment(),
            e.getDateOfJoining(), e.getEmploymentType(), e.getManagerId(),
            e.getSalaryAmountMinor(), e.getSalaryCurrency(), e.getStatus(),
            e.getCreatedAt()
        );
    }
}
