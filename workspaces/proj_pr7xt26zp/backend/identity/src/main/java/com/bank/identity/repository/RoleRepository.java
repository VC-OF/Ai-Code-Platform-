package com.bank.identity.repository;

import com.bank.identity.domain.Role;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface RoleRepository extends JpaRepository<Role, UUID> {

    Optional<Role> findByTenantIdAndCode(UUID tenantId, String code);

    Optional<Role> findByCodeAndScope(String code, String scope);

    List<Role> findByTenantIdOrScope(UUID tenantId, String scope);

    @Query("SELECT r FROM Role r WHERE r.code = :code")
    Optional<Role> findByCode(@Param("code") String code);
}
