package com.cbs.usermgmt.role.domain;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.UUID;

@Repository
public interface PermissionRepository extends JpaRepository<Permission, UUID> {

    @Query("select p from Permission p order by p.category, p.code")
    List<Permission> findAllOrdered();

    List<Permission> findByCodeIn(List<String> codes);
}
