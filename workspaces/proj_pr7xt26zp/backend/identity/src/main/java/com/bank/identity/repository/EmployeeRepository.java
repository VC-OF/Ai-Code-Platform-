package com.bank.identity.repository;

import com.bank.identity.domain.Employee;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface EmployeeRepository extends JpaRepository<Employee, UUID> {

    Optional<Employee> findByUserId(UUID userId);

    Optional<Employee> findByTenantIdAndEmployeeCode(UUID tenantId, String code);

    List<Employee> findByBranchId(UUID branchId);

    Page<Employee> findByTenantId(UUID tenantId, Pageable pageable);

    @Query("""
        SELECT e FROM Employee e
        WHERE e.tenantId = :tenantId
          AND (LOWER(e.firstName) LIKE LOWER(CONCAT('%', :q, '%'))
            OR LOWER(e.lastName)  LIKE LOWER(CONCAT('%', :q, '%'))
            OR LOWER(e.employeeCode) LIKE LOWER(CONCAT('%', :q, '%')))
        """)
    Page<Employee> search(@Param("tenantId") UUID tenantId, @Param("q") String q, Pageable pageable);
}
