package com.cbs.usermgmt.employee.domain;

import com.cbs.kernel.domain.base.AbstractAuditableEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

/**
 * Bank employee. Employees are users of the internal banking application
 * (tellers, managers, etc.). Their job role, salary and attendance are
 * tracked here.
 */
@Entity
@Table(name = "employees")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Employee extends AbstractAuditableEntity {

    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "employee_code", nullable = false, length = 30, unique = true)
    private String employeeCode;

    @Column(name = "first_name", nullable = false, length = 100)
    private String firstName;

    @Column(name = "last_name", length = 100)
    private String lastName;

    @Column(name = "email", length = 150)
    private String email;

    @Column(name = "phone", length = 30)
    private String phone;

    @Column(name = "branch_id")
    private UUID branchId;

    @Enumerated(EnumType.STRING)
    @Column(name = "job_role", nullable = false, length = 50)
    private JobRole jobRole;

    @Column(name = "date_of_joining", nullable = false)
    private LocalDate dateOfJoining;

    @Column(name = "date_of_leaving")
    private LocalDate dateOfLeaving;

    @Column(name = "salary_amount_minor", nullable = false)
    private long salaryAmountMinor;

    @Column(name = "salary_currency", nullable = false, length = 3)
    private String salaryCurrency;

    @Enumerated(EnumType.STRING)
    @Column(name = "status", nullable = false, length = 20)
    private EmployeeStatus status;

    public enum JobRole {
        SUPER_ADMIN, BANK_ADMIN, BRANCH_MANAGER, TELLER, LOAN_OFFICER,
        CUSTOMER_SERVICE, OPERATIONS, AUDITOR, IT_ADMIN
    }

    public enum EmployeeStatus {
        ACTIVE, ON_LEAVE, TERMINATED, RETIRED
    }
}
