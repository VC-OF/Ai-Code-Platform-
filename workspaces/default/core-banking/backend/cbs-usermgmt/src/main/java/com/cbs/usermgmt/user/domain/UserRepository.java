package com.cbs.usermgmt.user.domain;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.JpaSpecificationExecutor;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Repository
public interface UserRepository extends JpaRepository<User, UUID>, JpaSpecificationExecutor<User> {

    Optional<User> findByUsername(String username);

    Optional<User> findByEmail(String email);

    boolean existsByUsername(String username);

    boolean existsByEmail(String email);

    @Query("select distinct p.code from User u join u.roles r join r.permissions p " +
            "where u.id = :userId and u.status = com.cbs.usermgmt.user.domain.UserStatus.ACTIVE")
    List<String> findActivePermissionCodesByUserId(UUID userId);

    default Set<String> activePermissions(UUID userId) {
        return Set.copyOf(findActivePermissionCodesByUserId(userId));
    }
}
