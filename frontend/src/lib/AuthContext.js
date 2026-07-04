'use client';
import { createContext, useContext, useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

const AuthContext = createContext(null);

const DEFAULT_ORG = { id: 'acme-org-id', name: 'Acme Corporation' };

const DEFAULT_DEPTS = [
  { id: 'dept-eng', name: 'Engineering', organizationId: 'acme-org-id' },
  { id: 'dept-mktg', name: 'Marketing', organizationId: 'acme-org-id' },
  { id: 'dept-prod', name: 'Product Management', organizationId: 'acme-org-id' },
];

const DEFAULT_USERS = [
  {
    id: 'user-admin',
    name: 'Sundar Pichai',
    email: 'admin@acme.com',
    password: 'password',
    role: 'OrgAdmin',
    departmentId: 'dept-eng',
    organizationId: 'acme-org-id',
  },
  {
    id: 'user-manager',
    name: 'Steve Jobs',
    email: 'manager@acme.com',
    password: 'password',
    role: 'DeptManager',
    departmentId: 'dept-eng',
    organizationId: 'acme-org-id',
  },
  {
    id: 'user-member',
    name: 'Member User',
    email: 'member@acme.com',
    password: 'password',
    role: 'Member',
    departmentId: 'dept-eng',
    organizationId: 'acme-org-id',
  },
  {
    id: 'user-alice',
    name: 'Alice Smith',
    email: 'alice@acme.com',
    password: 'password',
    role: 'Member',
    departmentId: 'dept-eng',
    organizationId: 'acme-org-id',
  },
  {
    id: 'user-bob',
    name: 'Bob Johnson',
    email: 'bob@acme.com',
    password: 'password',
    role: 'Member',
    departmentId: 'dept-mktg',
    organizationId: 'acme-org-id',
  },
];

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [organization, setOrganization] = useState(null);
  const [department, setDepartment] = useState(null);
  const [users, setUsers] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  // Load database from localStorage or seed defaults
  useEffect(() => {
    try {
      let storedOrgs = localStorage.getItem('saas_orgs');
      let storedDepts = localStorage.getItem('saas_depts');
      let storedUsers = localStorage.getItem('saas_users');
      let storedCurrentUser = localStorage.getItem('saas_current_user');

      if (!storedOrgs || !storedDepts || !storedUsers) {
        // Seed initial data
        localStorage.setItem('saas_orgs', JSON.stringify([DEFAULT_ORG]));
        localStorage.setItem('saas_depts', JSON.stringify(DEFAULT_DEPTS));
        localStorage.setItem('saas_users', JSON.stringify(DEFAULT_USERS));
        storedOrgs = JSON.stringify([DEFAULT_ORG]);
        storedDepts = JSON.stringify(DEFAULT_DEPTS);
        storedUsers = JSON.stringify(DEFAULT_USERS);

        // Pre-associate existing database meetings with default department
        fetch('/api/meetings')
          .then((r) => r.json())
          .then((data) => {
            if (data?.meetings) {
              const meetingIds = data.meetings.map((m) => m.id);
              const mapping = { 'dept-eng': meetingIds };
              localStorage.setItem('saas_dept_meetings', JSON.stringify(mapping));
            }
          })
          .catch(() => {});
      }

      const parsedUsers = JSON.parse(storedUsers);
      const parsedDepts = JSON.parse(storedDepts);
      const parsedOrgs = JSON.parse(storedOrgs);

      setUsers(parsedUsers);
      setDepartments(parsedDepts);

      if (storedCurrentUser) {
        const currUser = JSON.parse(storedCurrentUser);
        setUser(currUser);
        
        const org = parsedOrgs.find((o) => o.id === currUser.organizationId);
        setOrganization(org || null);

        const dept = parsedDepts.find((d) => d.id === currUser.departmentId);
        setDepartment(dept || null);
      }
    } catch (e) {
      console.error('Error loading database', e);
    } finally {
      setLoading(false);
    }
  }, []);

  // Update localStorage when current user changes
  const saveSession = (currUser, activeOrg, activeDept) => {
    setUser(currUser);
    setOrganization(activeOrg);
    setDepartment(activeDept);
    if (currUser) {
      localStorage.setItem('saas_current_user', JSON.stringify(currUser));
    } else {
      localStorage.removeItem('saas_current_user');
    }
  };

  const login = (email, password) => {
    const foundUser = users.find(
      (u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password
    );
    if (!foundUser) {
      throw new Error('Invalid email or password');
    }

    const orgs = JSON.parse(localStorage.getItem('saas_orgs') || '[]');
    const org = orgs.find((o) => o.id === foundUser.organizationId);

    const depts = JSON.parse(localStorage.getItem('saas_depts') || '[]');
    const dept = depts.find((d) => d.id === foundUser.departmentId);

    saveSession(foundUser, org, dept);
    router.push('/');
    return foundUser;
  };

  const logout = () => {
    saveSession(null, null, null);
    router.push('/login');
  };

  const registerOrg = (orgName, adminName, adminEmail, adminPassword) => {
    // Check if user already exists
    if (users.some((u) => u.email.toLowerCase() === adminEmail.toLowerCase())) {
      throw new Error('Email is already registered');
    }

    const orgId = 'org-' + Date.now();
    const newOrg = { id: orgId, name: orgName };

    const deptId = 'dept-' + Date.now();
    const newDepts = [
      { id: deptId, name: 'Engineering', organizationId: orgId },
      { id: 'dept-mktg-' + Date.now(), name: 'Marketing', organizationId: orgId },
      { id: 'dept-prod-' + Date.now(), name: 'Product Management', organizationId: orgId },
    ];

    const adminId = 'user-' + Date.now();
    const newAdmin = {
      id: adminId,
      name: adminName,
      email: adminEmail,
      password: adminPassword,
      role: 'OrgAdmin',
      departmentId: deptId,
      organizationId: orgId,
    };

    const updatedOrgs = [...JSON.parse(localStorage.getItem('saas_orgs') || '[]'), newOrg];
    const updatedDepts = [...JSON.parse(localStorage.getItem('saas_depts') || '[]'), ...newDepts];
    const updatedUsers = [...JSON.parse(localStorage.getItem('saas_users') || '[]'), newAdmin];

    localStorage.setItem('saas_orgs', JSON.stringify(updatedOrgs));
    localStorage.setItem('saas_depts', JSON.stringify(updatedDepts));
    localStorage.setItem('saas_users', JSON.stringify(updatedUsers));

    setUsers(updatedUsers);
    setDepartments(updatedDepts);

    saveSession(newAdmin, newOrg, newDepts[0]);
    router.push('/');
    return newAdmin;
  };

  const createDepartment = (name) => {
    if (!organization) throw new Error('No active organization');
    const deptId = 'dept-' + Date.now();
    const newDept = { id: deptId, name, organizationId: organization.id };

    const storedDepts = JSON.parse(localStorage.getItem('saas_depts') || '[]');
    const updatedDepts = [...storedDepts, newDept];
    localStorage.setItem('saas_depts', JSON.stringify(updatedDepts));
    setDepartments(updatedDepts);
    return newDept;
  };

  const createUser = (name, email, password, role, targetDeptId) => {
    if (!organization) throw new Error('No active organization');

    const storedUsers = JSON.parse(localStorage.getItem('saas_users') || '[]');
    if (storedUsers.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
      throw new Error('User with this email already exists');
    }

    const userId = 'user-' + Date.now();
    const newUser = {
      id: userId,
      name,
      email,
      password,
      role,
      departmentId: targetDeptId,
      organizationId: organization.id,
    };

    const updatedUsers = [...storedUsers, newUser];
    localStorage.setItem('saas_users', JSON.stringify(updatedUsers));
    setUsers(updatedUsers);
    return newUser;
  };

  const switchDepartment = (deptId) => {
    const dept = departments.find((d) => d.id === deptId);
    if (dept) {
      setDepartment(dept);
      // Update department of current logged in user in active state and storage
      const updatedUser = { ...user, departmentId: deptId };
      setUser(updatedUser);
      localStorage.setItem('saas_current_user', JSON.stringify(updatedUser));
      
      // Update in local users database as well so it persists
      const storedUsers = JSON.parse(localStorage.getItem('saas_users') || '[]');
      const userIndex = storedUsers.findIndex((u) => u.id === user.id);
      if (userIndex !== -1) {
        storedUsers[userIndex].departmentId = deptId;
        localStorage.setItem('saas_users', JSON.stringify(storedUsers));
        setUsers(storedUsers);
      }
    }
  };

  const linkMeetingToDepartment = (meetingId, deptId) => {
    const currentMappings = JSON.parse(localStorage.getItem('saas_dept_meetings') || '{}');
    if (!currentMappings[deptId]) {
      currentMappings[deptId] = [];
    }
    if (!currentMappings[deptId].includes(meetingId)) {
      currentMappings[deptId].push(meetingId);
      localStorage.setItem('saas_dept_meetings', JSON.stringify(currentMappings));
    }
  };

  const getDepartmentMeetingIds = (deptId) => {
    const currentMappings = JSON.parse(localStorage.getItem('saas_dept_meetings') || '{}');
    return currentMappings[deptId] || [];
  };

  const isMeetingInDepartment = (meetingId, deptId) => {
    const ids = getDepartmentMeetingIds(deptId);
    return ids.includes(meetingId);
  };

  const activeOrgUsers = users.filter((u) => u.organizationId === organization?.id);
  const activeOrgDepartments = departments.filter((d) => d.organizationId === organization?.id);

  return (
    <AuthContext.Provider
      value={{
        user,
        organization,
        department,
        users: activeOrgUsers,
        departments: activeOrgDepartments,
        loading,
        login,
        logout,
        registerOrg,
        createDepartment,
        createUser,
        switchDepartment,
        linkMeetingToDepartment,
        getDepartmentMeetingIds,
        isMeetingInDepartment,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
