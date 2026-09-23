package com.bank.identity.domain;

import com.bank.platform.domain.Auditable;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.Instant;
import java.util.UUID;

/**
 * An employee of the bank. One-to-one with a {@link User} for staff accounts.
 * Customers have a separate {@code Customer} record in a later module.
 */
@Entity
@Table(name = "employee",
    uniqueConstraints = @UniqueConstraint(name = "uk_employee_tenant_user", columnNames = {"tenant_id", "user_id"}),
    indexes = {
        @Index(name = "idx_employee_tenant", columnList = "tenant_id"),
        @Index(name = "idx_employee_branch", columnList = "branch_id")
    })
@Getter
@Setter
@NoArgsConstructor
public class Employee extends Auditable {

    @jakarta.persistence.Id
    @Column(name = "id", nullable = false, updatable = false)
    private UUID id;

    @Column(name = "tenant_id", nullable = false)
    private UUID tenantId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "branch_id")
    private UUID branchId;

    @Column(name = "employee_code", nullable = false, length = 32)
    private String employeeCode;

    @Column(name = "first_name", nullable = false, length = 64)
    private String firstName;

    @Column(name = "last_name", nullable = false, length = 64)
    private String lastName;

    @Column(name = "designation", length = 64)
    private String designation;

    @Column(name = "department", length = 64)
    private String department;

    @Column(name = "date_of_joining", nullable = false)
    private java.time.LocalDate dateOfJoining;

    @Column(name = "employment_type", length = 16)
    private String employmentType = "FULL_TIME";

    @Column(name = "manager_id")
    private UUID managerId;

    @Column(name = "salary_amount_minor", nullable = false)
    private long salaryAmountMinor = 0;

    @Column(name = "salary_currency", nullable = false, length = 3)
    private String salaryCurrency = "USD";

    @Column(name = "status", nullable = false, length = 16)
    private String status = "ACTIVE";

    @Column(name = "left_at")
    private Instant leftAt;

    @Override
    public UUID getId() { return id; }

    public void newId() { this.id = UUID.randomUUID(); }
}
