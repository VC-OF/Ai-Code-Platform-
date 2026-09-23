package com.bank.identity.service;

import com.bank.identity.domain.Branch;
import com.bank.identity.domain.Employee;
import com.bank.identity.repository.BranchRepository;
import com.bank.identity.repository.EmployeeRepository;
import com.bank.platform.audit.AuditService;
import com.bank.platform.security.AuthenticatedUser;
import com.bank.platform.security.CurrentUser;
import com.bank.platform.web.error.ConflictException;
import com.bank.platform.web.error.NotFoundException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

/**
 * Branch CRUD plus the side-effect of creating a branch's primary cash
 * position (handled by the ledger module in a later phase).
 */
@Service
public class BranchService {

    private final BranchRepository branches;
    private final EmployeeRepository employees;
    private final AuditService audit;
    private final CurrentUser currentUser;

    public BranchService(BranchRepository branches, EmployeeRepository employees,
                         AuditService audit, CurrentUser currentUser) {
        this.branches = branches;
        this.employees = employees;
        this.audit = audit;
        this.currentUser = currentUser;
    }

    @Transactional
    public Branch create(Branch branch) {
        if (branches.findByTenantIdAndCode(branch.getTenantId(), branch.getCode()).isPresent()) {
            throw new ConflictException("BRANCH_DUPLICATE_CODE", "Branch code already exists");
        }
        if (branches.findByTenantIdAndIfsc(branch.getTenantId(), branch.getIfsc()).isPresent()) {
            throw new ConflictException("BRANCH_DUPLICATE_IFSC", "IFSC already exists");
        }
        branch.newId();
        Branch saved = branches.save(branch);
        audit.recordAction(currentUser.get().map(AuthenticatedUser::getUserId).orElse(null),
            "branch.create",
            "Created branch " + saved.getId() + " (" + saved.getCode() + ")");
        return saved;
    }

    @Transactional
    public Branch update(UUID id, Branch update) {
        Branch b = get(id);
        b.setName(update.getName());
        b.setEmail(update.getEmail());
        b.setPhone(update.getPhone());
        b.setAddressLine1(update.getAddressLine1());
        b.setAddressLine2(update.getAddressLine2());
        b.setCity(update.getCity());
        b.setState(update.getState());
        b.setPostalCode(update.getPostalCode());
        b.setCountryCode(update.getCountryCode());
        b.setOpenTime(update.getOpenTime());
        b.setCloseTime(update.getCloseTime());
        b.setManagerUserId(update.getManagerUserId());
        b.setStatus(update.getStatus());
        return branches.save(b);
    }

    @Transactional(readOnly = true)
    public Branch get(UUID id) {
        return branches.findById(id)
            .orElseThrow(() -> new NotFoundException("BRANCH_NOT_FOUND", "Branch " + id + " not found"));
    }

    @Transactional(readOnly = true)
    public Page<Branch> list(UUID tenantId, String q, Pageable pageable) {
        return (q == null || q.isBlank())
            ? branches.findByTenantId(tenantId, pageable)
            : branches.search(tenantId, q, pageable);
    }

    @Transactional
    public void softDelete(UUID id) {
        Branch b = get(id);
        b.softDelete("system");
        branches.save(b);
    }

    @Transactional(readOnly = true)
    public Page<Employee> listEmployees(UUID branchId, Pageable pageable) {
        // repository lacks a Page variant; convert manually
        java.util.List<Employee> all = employees.findByBranchId(branchId);
        int total = all.size();
        int start = (int) Math.min(pageable.getOffset(), total);
        int end = (int) Math.min(start + pageable.getPageSize(), total);
        return new org.springframework.data.domain.PageImpl<>(all.subList(start, end), pageable, total);
    }
}
