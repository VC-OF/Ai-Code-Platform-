package com.cbs.usermgmt.employee.domain;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface EmployeeRepository extends JpaRepository<Employee, UUID> {
    Optional<Employee> findByEmployeeCode(String code);
    Optional<Employee> findByUserId(UUID userId);
    boolean existsByEmployeeCode(String code);
}
