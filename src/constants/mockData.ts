import { Control } from '../types';

export const MOCK_CONTROLS: Record<string, Control[]> = {
  'djbh-l3': [
    // 1. 物理环境安全 (PE)
    { id: 'S3-PE1', name: '物理访问控制', requirement: '机房出入口应安排专人值守或配置电子门禁系统，鉴别进入人员身份。', priority: 'High', command: 'check_physical_access --gate 1' },
    { id: 'S3-PE2', name: '防火防雷', requirement: '机房应设置火灾自动消防系统，应设置防雷保安器以防止雷击。', priority: 'Medium', command: 'inspect_fire_system --facility A' },
    { id: 'S3-PE3', name: '温湿度控制', requirement: '应设置温、湿度自动调节设施，使机房温、湿度的变化在设备运行允许的范围之内。', priority: 'Low', command: 'get_sensor_history --room 101' },
    
    // 2. 通信网络安全 (CN)
    { id: 'S3-CN1', name: '网络链路冗余', requirement: '应提供通信线路硬件冗余，保证通信网络可用性等级。', priority: 'High', command: 'ip link show' },
    { id: 'S3-CN2', name: '通信保密性', requirement: '应采用密码技术保证重要数据在传输过程中的保密性。', priority: 'High', command: 'openssl s_client -connect localhost:443' },
    { id: 'S3-CN3', name: '通信完整性', requirement: '应采用密码技术保证通信过程中数据的完整性。', priority: 'High', command: 'check_packet_integrity --config all' },
    
    // 3. 网络边界安全 (NB)
    { id: 'S3-NB1', name: '边界防护', requirement: '应能够限制与非授权机构之间的无线通信，应能够跨越边界进行非法外联检查。', priority: 'High', command: 'iptables -L -n' },
    { id: 'S3-NB2', name: '访问控制', requirement: '应在网络边界部署访问控制设备，对进出方向业务流进行源/目的地址级过滤。', priority: 'High', command: 'cat /etc/sysconfig/iptables' },
    { id: 'S3-NB3', name: '入侵防范', requirement: '应在关键网络节点处监视并记录网络攻击行为。', priority: 'Medium', command: 'tail -f /var/log/snort/alert' },
    
    // 4. 计算环境安全 (CE)
    { id: 'S3-CE1', name: '多因子身份鉴别', requirement: '应对登录用户进行身份鉴别，并采用口令、密码技术、生物技术等两种以上技术。', priority: 'High', command: 'cat /etc/pam.d/system-auth' },
    { id: 'S3-CE2', name: '访问控制粒度', requirement: '访问控制粒度应达到主体为用户级或进程级，客体为文件、数据库表级。', priority: 'High', command: 'ls -l /etc/shadow && mysql -e "SHOW GRANTS FOR \'user\'@\'localhost\';"' },
    { id: 'S3-CE3', name: '三权分立', requirement: '应实现管理用户的权限分离，包括系统管理员、审计员和安全管理员。', priority: 'High', command: 'cat /etc/passwd | cut -d: -f1,3' },
    { id: 'S3-CE4', name: '安全审计记录', requirement: '审计记录应覆盖每个用户，记录日期、时间、用户标识、事件类型、结果等。', priority: 'High', command: 'ausearch -m USER_AUTH,USER_LOGIN' },
    { id: 'S3-CE5', name: '审计保护', requirement: '审计记录应至少保存6个月，防止非授权删除、修改或覆盖。', priority: 'High', command: 'ls -lh /var/log/audit/ && grep "max_log_file_action" /etc/audit/auditd.conf' },
    { id: 'S3-CE6', name: '个人信息保护', requirement: '应仅采集业务必需的个人信息，并对个人信息的采集、传输、存储环节进行保护。', priority: 'High', command: 'check_data_privacy_policy' },
    { id: 'S3-CE7', name: '可信验证', requirement: '应基于可信根对引导程序、系统程序、重要配置参数进行可信验证。', priority: 'Medium', command: 'tpm2_pcrread sha256:0,1,2,3' },
    { id: 'S3-CE8', name: '恶意代码防范', requirement: '应在关键节点部署动态病毒监测或类似防护机制。', priority: 'High', command: 'systemctl status clamav-freshclam' },
    
    // 5. 管理中心安全 (MC)
    { id: 'S3-MC1', name: '集中审计', requirement: '应划分出特定的管理网段，进行集中审计管理。', priority: 'Medium', command: 'grep "remote_server" /etc/audit/audisp-remote.conf' },
    { id: 'S3-MC2', name: '集中管控', requirement: '应能对网络设备、安全设备、主机设备状态进行集中监控。', priority: 'Medium', command: 'systemctl status snmpd' },
    
    // 6. 管理制度 (MS)
    { id: 'S3-MS1', name: '管理制度体系', requirement: '应形成由安全策略、管理制度、操作规程、记录表单组成的完整体系。', priority: 'High', command: 'ls /opt/compliance/docs/' },
    { id: 'S3-MS2', name: '定期修订', requirement: '应定期对安全管理制度的合理性和适用性进行评审和修订。', priority: 'Medium', command: 'stat /opt/compliance/docs/policy_v2.pdf' },
    
    // 7. 管理机构 (MO)
    { id: 'S3-MO1', name: '岗位设置', requirement: '应设立专门的安全管理机构，并配备安全主管、安全管理员、审计员等。', priority: 'High', command: 'cat /etc/group | grep "secadmin\\|auditadmin"' },
    
    // 8. 人员管理 (PM)
    { id: 'S3-PM1', name: '背景审查', requirement: '应对相关人员进行背景审查，定期进行安全意识教育和技能培训。', priority: 'Medium', command: 'ls /var/lib/hr/records/' },
    { id: 'S3-PM2', name: '离岗处理', requirement: '应在人员离岗后及时终止其所有访问权限。', priority: 'High', command: 'check_disabled_accounts --last-30-days' },
    
    // 9. 建设管理 (BM)
    { id: 'S3-BM1', name: '方案设计', requirement: '建设方案应进行充分评审和论证。', priority: 'Medium', command: 'ls /data/project/design_reviews/' },
    
    // 10. 运维管理 (OM)
    { id: 'S3-OM1', name: '漏洞扫描', requirement: '应定期对系统镜像或主机进行漏洞扫描。', priority: 'High', command: 'nessus-cli --status' },
  ],
  'djbh-l2': [
    { id: 'S2-T1', name: '身份鉴别 (口令)', requirement: '应对登录用户进行身份鉴别，口令应有复杂度要求并定期更换，防止弱口令。', priority: 'High', command: 'grep "password" /etc/login.defs' },
    { id: 'S2-T2', name: '常规访问控制', requirement: '应根据受控的机制分配权限，禁止默认账号，限制特权账号，遵循最小化原则。', priority: 'High', command: 'cat /etc/passwd | awk -F: \'$3 == 0 { print $1 }\'' },
    { id: 'S2-T3', name: '基础安全审计', requirement: '应启用审计功能，记录重要用户行为与安全事件，审计记录保存时间不少于6个月。', priority: 'Medium', command: 'systemctl status auditd' },
    { id: 'S2-T4', name: '恶意代码防护', requirement: '应安装防病毒软件并保持病毒库更新，对重要节点实施定期扫描检测。', priority: 'Medium', command: 'clamscan --version' },
    { id: 'S2-T5', name: '本地备份恢复', requirement: '应提供重要数据的本地备份与恢复能力，定期验证备份数据的有效性。', priority: 'Medium', command: 'ls -R /backup' },
    { id: 'S2-M1', name: '基本制度规程', requirement: '应制定安全管理制度、管理制度和岗位职责说明，明确系统各环节的安全要求。', priority: 'High', command: 'ls /etc/security/policies' },
  ],
  'iso27001': [
    { id: 'A.5.1', name: '信息安全策略', requirement: '管理层应对信息安全方针进行审定，发布并传达给所有员工。', priority: 'High', command: 'check_policy_distribution' },
    { id: 'A.6.1', name: '内部组织', requirement: '应建立信息安全职责分工，并确立管理层承诺。', priority: 'Medium', command: 'check_org_chart' },
  ],
  'iso27701': [
    { id: 'PIMS-5.2', name: '隐私方针与角色', requirement: '应制定并维护隐私信息方针，明确隐私角色与职责。', priority: 'High', command: 'check_privacy_policy' },
    { id: 'PIMS-6.3', name: '数据处理记录', requirement: '应维护处理活动的记录（RoPA），包括目的、类别、接收方等。', priority: 'High', command: 'check_ropa_registry' },
    { id: 'PIMS-8.2', name: '个人权利响应', requirement: '应建立流程以响应主体访问、更正、删除等请求并在约定期限内完成。', priority: 'High', command: 'check_dsar_sla' },
  ],
  gdpr: [
    { id: 'GDPR-5', name: '数据处理原则', requirement: '个人数据的处理应合法、公平、透明，并限于特定、明确、合法目的。', priority: 'High', command: 'check_lawful_basis' },
    { id: 'GDPR-12', name: '透明与信息告知', requirement: '应向数据主体提供简洁、易懂的隐私信息，说明控制者身份与处理目的。', priority: 'High', command: 'check_privacy_notice' },
    { id: 'GDPR-32', name: '安全与保密', requirement: '应采取适当技术与组织措施，确保与风险相称的安全性与保密性。', priority: 'High', command: 'check_security_measures' },
  ],
};
