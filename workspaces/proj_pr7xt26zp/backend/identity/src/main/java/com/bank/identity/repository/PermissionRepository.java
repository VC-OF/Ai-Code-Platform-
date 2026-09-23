package com.bank.identity.repository;

import com.bank.identity.domain.Permission;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public interface PermissionRepository extends JpaRepository<Permission, UUID> {

    Optional<Permission> findByCode(String code);

    List<Permission> findByCategory(String category);

    @Query("""
        SELECT DISTINCT p FROM Permission p
        JOIN RolePermission rp ON rp.id.permissionId = p.id
        JOIN UserRole ur ON ur.id.roleId = rp.id.roleId
        WHERE ur.id.userId = :userId
        """)
    List<Permission> findPermissionsForUser(@Param("userId") UUID userId);
}
